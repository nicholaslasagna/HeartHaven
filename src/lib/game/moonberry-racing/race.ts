/**
 * Moonberry Racing — race manager.
 *
 * Owns the shape of a race: who is in it, what phase it is in, who is where,
 * and who won. Pure — no three.js, no DOM, no network calls. The transport
 * layer feeds it reports and reads state back out.
 *
 * MULTIPLAYER MODEL
 *
 * Host-authoritative, but only over the things that decide the result:
 *
 *   • The HOST owns lap and checkpoint progress. Clients report a POSITION;
 *     the host projects that position onto the centreline and runs the same
 *     `updateLapProgress` everyone else does. A client that claims lap 3 on
 *     its first corner is simply overruled, because its claimed lap is never
 *     read — only its coordinates are. See `applyRacerReport`.
 *   • The HOST owns finish order and finish times, stamped from race time
 *     rather than from anything a client sends.
 *   • Each CLIENT owns its own kart's motion. Driving is latency-sensitive
 *     and a 100ms round trip on steering would feel awful, so karts are
 *     simulated locally and reconciled visually. This is a deliberate trade:
 *     someone running a modified client can make their own kart handle
 *     impossibly, but they cannot gain a lap, skip a checkpoint, or fake a
 *     win, because none of those come from the client.
 *   • Countdown is DERIVED from a single shared `startAt` timestamp, not
 *     counted down independently, so eight machines agree without a tick
 *     message and a late-arriving client lands on the correct number.
 *   • Hazards and item rolls are pure functions of race time and seeds, so
 *     they never travel over the wire at all.
 *
 * A disconnect must never stall a race, so nothing here waits on a racer:
 * the race ends when every CONNECTED racer has finished, and a disconnected
 * racer's result is preserved as DNF rather than blocking anyone.
 */

import { createKart, type KartBody } from "./kart";
import { stepEffects, type ActiveEffect, type PowerUp } from "./powerups";
import {
  createLapProgress,
  projectToCourse,
  racePositions,
  respawnPose,
  startingGrid,
  updateLapProgress,
  type Course,
  type LapProgress,
} from "./track";

export type RacePhase = "lobby" | "countdown" | "racing" | "finished";

export const COUNTDOWN_MS = 3000;
/** Grace after the leader finishes before stragglers are timed out. */
export const FINISH_GRACE_MS = 45_000;
/** No report for this long and a racer is treated as gone. */
export const DISCONNECT_MS = 6_000;

export type Racer = {
  id: string;
  seat: number;
  name: string;
  companion?: RacerCompanion;
  /** Local player on this machine. */
  local: boolean;
  kart: KartBody;
  progress: LapProgress;
  effects: ActiveEffect[];
  item: PowerUp | null;
  connected: boolean;
  /** Joined after the lights went out: watches, does not race. */
  spectator: boolean;
  /** Race-time ms when they crossed the line, null while still running. */
  finishedAt: number | null;
  bestLapMs: number | null;
  lastLapStartMs: number;
  /** Race-time ms of their last report, for disconnect detection. */
  lastSeenMs: number;
  position: number;
};

export type RaceEvent =
  | { type: "joined"; racerId: string; name: string }
  | { type: "left"; racerId: string; name: string }
  | { type: "rejoined"; racerId: string; name: string }
  | { type: "spectating"; racerId: string; name: string }
  | { type: "finished"; racerId: string; name: string; position: number; ms: number }
  | { type: "lap"; racerId: string; lap: number; finalLap: boolean }
  | { type: "respawn"; racerId: string }
  | { type: "countdown"; value: number }
  | { type: "start" }
  | { type: "race-over" };

/** Appearance-only payload. It is never used for race authority or scoring. */
export type RacerCompanion = {
  speciesId: string;
  toneId: string;
  accessory: string;
};

export type RacerReport = {
  racerId: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  driftCharge: number;
  boosting: boolean;
  companion?: RacerCompanion;
};

export class Race {
  readonly racers = new Map<string, Racer>();
  readonly events: RaceEvent[] = [];
  phase: RacePhase = "lobby";
  /** Wall-clock ms when the lights go out. Shared by every client. */
  startAt: number | null = null;
  /** Seconds of racing elapsed; 0 until the start. */
  raceTime = 0;
  private lastCountdownShown = -1;
  private leaderFinishedAt: number | null = null;

  constructor(readonly course: Course, readonly isHost: boolean) {}

  /* -------------------------------------------------------------- */
  /* Roster                                                          */
  /* -------------------------------------------------------------- */

  join(id: string, name: string, seat: number, local: boolean, companion?: RacerCompanion) {
    const existing = this.racers.get(id);
    if (existing) {
      // A reconnect keeps the racer's progress; they pick up where they were.
      existing.name = name;
      existing.seat = seat;
      existing.local = local;
      if (companion) existing.companion = companion;
      if (!existing.connected) {
        existing.connected = true;
        existing.lastSeenMs = this.raceTime * 1000;
        this.events.push({ type: "rejoined", racerId: id, name: existing.name });
      }
      return existing;
    }

    // Once the race is under way, a newcomer watches rather than being
    // dropped onto the track halfway round a lap.
    const spectator = this.phase === "racing" || this.phase === "finished";
    const grid = startingGrid(this.course, Math.max(2, seat + 1));
    const pose = grid[Math.min(seat, grid.length - 1)];

    const racer: Racer = {
      id, seat, name, local, companion,
      kart: createKart(pose.position.x, pose.position.y, pose.position.z, pose.heading),
      progress: createLapProgress(),
      effects: [],
      item: null,
      connected: true,
      spectator,
      finishedAt: null,
      bestLapMs: null,
      lastLapStartMs: 0,
      lastSeenMs: this.raceTime * 1000,
      position: seat + 1,
    };
    this.racers.set(id, racer);
    this.events.push(
      spectator
        ? { type: "spectating", racerId: id, name }
        : { type: "joined", racerId: id, name },
    );
    return racer;
  }

  leave(id: string) {
    const racer = this.racers.get(id);
    if (!racer) return;
    racer.connected = false;
    this.events.push({ type: "left", racerId: id, name: racer.name });
    // Deliberately NOT deleted: their result and position are preserved, and
    // removing them mid-race would renumber everyone behind them.
  }

  /** Racers actually contesting the race right now. */
  get contenders() {
    return [...this.racers.values()].filter((r) => !r.spectator);
  }

  /* -------------------------------------------------------------- */
  /* Phases                                                          */
  /* -------------------------------------------------------------- */

  /** Host only: arm the countdown. Everyone derives the rest from startAt. */
  beginCountdown(now: number) {
    if (this.phase !== "lobby") return false;
    if (this.contenders.length < 1) return false;
    this.startAt = now + COUNTDOWN_MS;
    this.phase = "countdown";
    return true;
  }

  /** Adopt a startAt received from the host. */
  adoptStart(startAt: number) {
    this.startAt = startAt;
    if (this.phase === "lobby") this.phase = "countdown";
  }

  /**
   * Advance the clock. `now` is wall-clock ms so the countdown stays in step
   * across machines; `dt` is the local frame delta for effects.
   */
  tick(now: number, dt: number) {
    if (this.phase === "countdown" && this.startAt !== null) {
      const remaining = this.startAt - now;
      const shown = Math.max(0, Math.ceil(remaining / 1000));
      if (shown !== this.lastCountdownShown) {
        this.lastCountdownShown = shown;
        this.events.push({ type: "countdown", value: shown });
      }
      if (remaining <= 0) {
        this.phase = "racing";
        this.raceTime = 0;
        this.events.push({ type: "start" });
      }
      return;
    }

    if (this.phase !== "racing") return;
    this.raceTime = Math.max(0, (now - (this.startAt ?? now)) / 1000);

    for (const racer of this.racers.values()) {
      racer.effects = stepEffects(racer.effects, dt);
      // Silence for too long is a disconnect. Local players never time out.
      if (!racer.local && racer.connected && this.raceTime * 1000 - racer.lastSeenMs > DISCONNECT_MS) {
        this.leave(racer.id);
      }
    }

    this.updatePositions();
    this.checkRaceOver();
  }

  /* -------------------------------------------------------------- */
  /* Authority                                                       */
  /* -------------------------------------------------------------- */

  /**
   * Take a racer's reported position and derive their progress from it.
   *
   * Note what is NOT read here: any lap or checkpoint number the client may
   * have sent. Progress is recomputed from coordinates through the same
   * validator every racer uses, which is what makes claiming a lap useless.
   */
  applyRacerReport(report: RacerReport) {
    const racer = this.racers.get(report.racerId);
    if (!racer || racer.spectator) return;

    racer.lastSeenMs = this.raceTime * 1000;
    if (!racer.connected) {
      racer.connected = true;
      this.events.push({ type: "rejoined", racerId: racer.id, name: racer.name });
    }

    racer.kart.x = report.x;
    racer.kart.y = report.y;
    racer.kart.z = report.z;
    racer.kart.heading = report.heading;
    racer.kart.speed = report.speed;
    racer.kart.driftCharge = report.driftCharge;
    if (report.companion) racer.companion = report.companion;

    this.advanceProgress(racer);
  }

  /** Recompute one racer's lap state from wherever their kart now is. */
  advanceProgress(racer: Racer) {
    if (racer.spectator || racer.progress.finished) return;

    const projected = projectToCourse(this.course, racer.kart.x, racer.kart.z, racer.progress.t);
    // Are they pointing along the track or against it?
    const facingX = Math.sin(racer.kart.heading);
    const facingZ = Math.cos(racer.kart.heading);
    const dot = facingX * projected.tangent.x + facingZ * projected.tangent.z;

    const before = racer.progress;
    racer.progress = updateLapProgress(before, this.course, projected.t, dot);

    if (racer.progress.lap > before.lap) {
      const lapMs = this.raceTime * 1000 - racer.lastLapStartMs;
      racer.lastLapStartMs = this.raceTime * 1000;
      if (lapMs > 1000 && (racer.bestLapMs === null || lapMs < racer.bestLapMs)) {
        racer.bestLapMs = lapMs;
      }
      this.events.push({
        type: "lap",
        racerId: racer.id,
        lap: racer.progress.lap,
        finalLap: racer.progress.lap === this.course.laps - 1,
      });
    }

    if (racer.progress.finished && racer.finishedAt === null) {
      racer.finishedAt = Math.round(this.raceTime * 1000);
      if (this.leaderFinishedAt === null) this.leaderFinishedAt = racer.finishedAt;
      const order = this.finishOrder();
      this.events.push({
        type: "finished",
        racerId: racer.id,
        name: racer.name,
        position: order.findIndex((r) => r.id === racer.id) + 1,
        ms: racer.finishedAt,
      });
    }
  }

  /** Fell off, or got wedged. Lap is preserved; only the pose is reset. */
  respawn(racerId: string) {
    const racer = this.racers.get(racerId);
    if (!racer) return;
    // Stagger by seat so two racers respawning together do not overlap.
    const lane = ((racer.seat % 3) - 1) * 2.2;
    const pose = respawnPose(this.course, racer.progress, lane);
    racer.kart.x = pose.position.x;
    racer.kart.y = pose.position.y;
    racer.kart.z = pose.position.z;
    racer.kart.heading = pose.heading;
    racer.kart.speed = 0;
    racer.kart.vy = 0;
    racer.kart.driftCharge = 0;
    racer.kart.driftSide = 0;
    racer.kart.invulnTimer = 2;
    this.events.push({ type: "respawn", racerId });
  }

  private updatePositions() {
    const running = this.contenders.map((r) => ({ id: r.id, progress: r.progress }));
    for (const entry of racePositions(running)) {
      const racer = this.racers.get(entry.id);
      if (racer) racer.position = entry.position;
    }
  }

  /**
   * Finish order: finishers by time, then everyone else by progress. A
   * disconnected racer keeps whatever they achieved rather than vanishing.
   */
  finishOrder() {
    return [...this.contenders].sort((a, b) => {
      if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
      if (a.finishedAt !== null) return -1;
      if (b.finishedAt !== null) return 1;
      return b.progress.progress - a.progress.progress;
    });
  }

  /**
   * The race is over once every CONNECTED contender is home. Waiting on a
   * disconnected racer would hang the results screen for everyone else, so
   * they are never waited on; a grace window then times out stragglers.
   */
  private checkRaceOver() {
    const contenders = this.contenders;
    if (contenders.length === 0) return;

    const connected = contenders.filter((r) => r.connected);
    const allHome = connected.length > 0 && connected.every((r) => r.finishedAt !== null);
    const graceExpired =
      this.leaderFinishedAt !== null &&
      this.raceTime * 1000 - this.leaderFinishedAt > FINISH_GRACE_MS;

    if (allHome || graceExpired) {
      this.phase = "finished";
      this.events.push({ type: "race-over" });
    }
  }

  /** Did-not-finish list, for the results screen. */
  dnf() {
    return this.contenders.filter((r) => r.finishedAt === null);
  }

  /** Host only: put everyone back on the grid for another race. */
  rematch() {
    this.phase = "lobby";
    this.startAt = null;
    this.raceTime = 0;
    this.lastCountdownShown = -1;
    this.leaderFinishedAt = null;

    const grid = startingGrid(this.course, Math.max(2, this.racers.size));
    let index = 0;
    for (const racer of this.racers.values()) {
      const pose = grid[Math.min(index, grid.length - 1)];
      index += 1;
      racer.kart = createKart(pose.position.x, pose.position.y, pose.position.z, pose.heading);
      racer.progress = createLapProgress();
      racer.effects = [];
      racer.item = null;
      racer.finishedAt = null;
      racer.bestLapMs = null;
      racer.lastLapStartMs = 0;
      // Anyone who was watching gets to race the next one.
      racer.spectator = false;
      racer.position = index;
    }
  }

  drainEvents() {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }
}
