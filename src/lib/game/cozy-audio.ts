"use client";

export type CozyCue =
  | "ui"
  | "move"
  | "avatarStep"
  | "pet"
  | "petChirp"
  | "petPurr"
  | "petSleep"
  | "place"
  | "rotate"
  | "water"
  | "catch"
  | "combo"
  | "thorn"
  | "score"
  | "reward"
  | "bowling"
  | "roll"
  | "pin"
  | "strike"
  | "spare"
  | "gutter"
  | "match"
  | "cardFlip"
  | "miss"
  | "lantern"
  | "heart"
  | "emote"
  /** New: short, soft chime when a chat message is sent or received. */
  | "speech";

type CozyAudioState = {
  context: AudioContext | null;
  enabled: boolean;
  effectsGain: GainNode | null;
  masterGain: GainNode | null;
  musicGain: GainNode | null;
  musicStep: number;
  musicTimer: number | null;
};

declare global {
  interface Window {
    __hearthavenAudio?: CozyAudioState;
  }
}

/**
 * A small library of cozy melodies. We rotate between them on each music
 * loop so the keeper isn't listening to the same eight notes forever.
 * Each melody is just a sequence of frequencies (Hz) — the sine/triangle
 * synth in `startMusicLoop` picks them up and plays one note per beat.
 */
const COZY_MELODIES: number[][] = [
  // Cozy major-pentatonic — the original loop, kept as the morning vibe.
  [261.63, 329.63, 392, 493.88, 587.33, 493.88, 392, 329.63],
  // Twilight lullaby — descending phrase with a soft lift at the end.
  [392, 349.23, 329.63, 293.66, 261.63, 293.66, 329.63, 392],
  // Garden waltz — three-feel built from D major arpeggios.
  [293.66, 369.99, 440, 369.99, 293.66, 246.94, 293.66, 369.99],
  // Lantern hum — slow, two-note motif that feels like dusk.
  [220, 261.63, 220, 196, 220, 261.63, 329.63, 261.63],
  // Friend visit — bright pentatonic for the moment a guest arrives.
  [523.25, 587.33, 659.25, 587.33, 523.25, 440, 523.25, 587.33],
];

const VOLUME_STORAGE_KEY = "hearthaven:audio-volume";

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function readStoredVolume() {
  if (typeof window === "undefined") return 0.74;
  const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
  const parsed = raw === null ? NaN : parseFloat(raw);
  return Number.isFinite(parsed) ? clamp01(parsed) : 0.74;
}

function getState(): CozyAudioState | null {
  if (typeof window === "undefined") return null;

  window.__hearthavenAudio ??= {
    context: null,
    enabled: false,
    effectsGain: null,
    masterGain: null,
    musicGain: null,
    musicStep: 0,
    musicTimer: null,
  };

  return window.__hearthavenAudio;
}

function ensureAudioGraph() {
  const state = getState();
  if (!state) return null;

  if (!state.context) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.context = new AudioContextClass();

    state.masterGain = state.context.createGain();
    state.masterGain.gain.value = readStoredVolume();
    state.masterGain.connect(state.context.destination);

    state.musicGain = state.context.createGain();
    state.musicGain.gain.value = 0.12;
    state.musicGain.connect(state.masterGain);

    state.effectsGain = state.context.createGain();
    state.effectsGain.gain.value = 0.34;
    state.effectsGain.connect(state.masterGain);
  }

  return state;
}

export async function startCozyAudio() {
  const state = ensureAudioGraph();
  if (!state?.context) return false;

  state.enabled = true;
  await state.context.resume();
  startMusicLoop(state);
  playCozyCue("reward");
  return true;
}

export function stopCozyAudio() {
  const state = getState();
  if (!state) return;

  state.enabled = false;
  if (state.musicTimer) {
    window.clearInterval(state.musicTimer);
    state.musicTimer = null;
  }
}

export function isCozyAudioEnabled() {
  return Boolean(getState()?.enabled);
}

/** Read the current master volume (0–1). Persists across reloads. */
export function getCozyVolume(): number {
  return readStoredVolume();
}

/**
 * Adjust the master volume in real time. Persisted to localStorage so the
 * keeper's preferred level survives a reload. Set to 0 to mute without
 * killing the loop — handy for the sound-on toggle.
 */
export function setCozyVolume(next: number) {
  const value = clamp01(next);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(value));
  }
  const state = getState();
  if (state?.masterGain) {
    state.masterGain.gain.value = value;
  }
}

export function playCozyCue(cue: CozyCue) {
  const state = ensureAudioGraph();
  if (!state?.enabled || !state.context || !state.effectsGain) return;

  const now = state.context.currentTime;

  switch (cue) {
    case "move":
      playTone(state, 392, now, 0.08, "sine", 0.11);
      playTone(state, 523.25, now + 0.06, 0.11, "triangle", 0.08);
      break;
    case "avatarStep":
      playTone(state, 196, now, 0.045, "triangle", 0.055);
      playTone(state, 246.94, now + 0.035, 0.055, "sine", 0.042);
      break;
    case "pet":
    case "petChirp":
      playTone(state, 659.25, now, 0.1, "triangle", 0.1);
      playTone(state, 880, now + 0.08, 0.16, "sine", 0.08);
      break;
    case "petPurr":
      playTone(state, 146.83, now, 0.2, "sine", 0.055);
      playTone(state, 174.61, now + 0.08, 0.2, "triangle", 0.045);
      playNoise(state, now, 0.18, 0.025, 180);
      break;
    case "petSleep":
      playTone(state, 329.63, now, 0.14, "sine", 0.045);
      playTone(state, 246.94, now + 0.12, 0.22, "sine", 0.035);
      break;
    case "place":
      playTone(state, 349.23, now, 0.06, "triangle", 0.08);
      playTone(state, 440, now + 0.05, 0.08, "triangle", 0.07);
      break;
    case "rotate":
      playTone(state, 523.25, now, 0.05, "square", 0.045);
      playTone(state, 659.25, now + 0.04, 0.07, "triangle", 0.075);
      break;
    case "water":
      playNoise(state, now, 0.2, 0.08, 900);
      playTone(state, 783.99, now + 0.03, 0.16, "sine", 0.06);
      break;
    case "catch":
      playTone(state, 587.33, now, 0.08, "triangle", 0.09);
      playTone(state, 783.99, now + 0.05, 0.12, "triangle", 0.08);
      break;
    case "combo":
      playTone(state, 659.25, now, 0.06, "triangle", 0.08);
      playTone(state, 880, now + 0.045, 0.07, "triangle", 0.07);
      playTone(state, 1174.66, now + 0.09, 0.12, "sine", 0.065);
      break;
    case "thorn":
      playTone(state, 174.61, now, 0.18, "sawtooth", 0.08);
      playNoise(state, now, 0.12, 0.06, 220);
      break;
    case "score":
    case "match":
      playTone(state, 523.25, now, 0.08, "triangle", 0.09);
      playTone(state, 659.25, now + 0.07, 0.08, "triangle", 0.08);
      playTone(state, 783.99, now + 0.14, 0.12, "sine", 0.08);
      break;
    case "cardFlip":
      playTone(state, 440, now, 0.035, "square", 0.035);
      playTone(state, 659.25, now + 0.035, 0.065, "triangle", 0.05);
      break;
    case "miss":
      playTone(state, 329.63, now, 0.08, "triangle", 0.07);
      playTone(state, 246.94, now + 0.06, 0.13, "sine", 0.06);
      break;
    case "bowling":
    case "pin":
      playNoise(state, now, 0.18, 0.1, 180);
      playTone(state, 196, now, 0.12, "triangle", 0.08);
      break;
    case "roll":
      playNoise(state, now, 0.28, 0.055, 120);
      playTone(state, 98, now, 0.18, "sine", 0.045);
      break;
    case "strike":
      playNoise(state, now, 0.24, 0.13, 260);
      playTone(state, 261.63, now, 0.09, "triangle", 0.08);
      playTone(state, 392, now + 0.08, 0.1, "triangle", 0.08);
      playTone(state, 523.25, now + 0.16, 0.14, "sine", 0.075);
      break;
    case "spare":
      playTone(state, 329.63, now, 0.08, "triangle", 0.08);
      playTone(state, 493.88, now + 0.08, 0.1, "triangle", 0.075);
      playTone(state, 659.25, now + 0.16, 0.14, "sine", 0.065);
      break;
    case "gutter":
      playTone(state, 220, now, 0.11, "sawtooth", 0.055);
      playTone(state, 164.81, now + 0.1, 0.18, "sine", 0.045);
      playNoise(state, now + 0.02, 0.16, 0.035, 120);
      break;
    case "lantern":
      playTone(state, 493.88, now, 0.1, "sine", 0.08);
      playTone(state, 739.99, now + 0.08, 0.18, "triangle", 0.07);
      break;
    case "heart":
    case "emote":
      playTone(state, 659.25, now, 0.07, "triangle", 0.08);
      playTone(state, 987.77, now + 0.07, 0.16, "sine", 0.07);
      break;
    case "speech":
      // Two soft pings — a "speech bubble" cue. Triangle at low volume so
      // it never grates when chat is busy.
      playTone(state, 587.33, now, 0.05, "triangle", 0.05);
      playTone(state, 783.99, now + 0.06, 0.08, "sine", 0.045);
      break;
    case "reward":
      playTone(state, 392, now, 0.1, "triangle", 0.08);
      playTone(state, 523.25, now + 0.09, 0.11, "triangle", 0.08);
      playTone(state, 659.25, now + 0.18, 0.12, "triangle", 0.08);
      playTone(state, 1046.5, now + 0.28, 0.22, "sine", 0.07);
      break;
    case "ui":
    default:
      playTone(state, 523.25, now, 0.06, "triangle", 0.07);
      break;
  }
}

function startMusicLoop(state: CozyAudioState) {
  if (!state.context || !state.musicGain || state.musicTimer) return;

  // Pick a melody to start on; rotate to a fresh one every full bar so the
  // background music doesn't feel like a single eight-note loop.
  let melodyIndex = Math.floor(Math.random() * COZY_MELODIES.length);

  const playStep = () => {
    if (!state.enabled || !state.context || !state.musicGain) return;
    const melody = COZY_MELODIES[melodyIndex % COZY_MELODIES.length];
    const now = state.context.currentTime;
    const note = melody[state.musicStep % melody.length];
    const harmony = melody[(state.musicStep + 2) % melody.length] / 2;
    playTone(state, note, now, 0.34, "sine", 0.09, state.musicGain);
    playTone(state, harmony, now + 0.02, 0.48, "triangle", 0.045, state.musicGain);
    state.musicStep += 1;
    // When we finish the melody, swap to a different one for variety.
    if (state.musicStep % melody.length === 0) {
      let next = melodyIndex;
      // Avoid replaying the same melody back-to-back.
      while (next === melodyIndex && COZY_MELODIES.length > 1) {
        next = Math.floor(Math.random() * COZY_MELODIES.length);
      }
      melodyIndex = next;
    }
  };

  playStep();
  state.musicTimer = window.setInterval(playStep, 720);
}

function playTone(
  state: CozyAudioState,
  frequency: number,
  start: number,
  duration: number,
  type: OscillatorType,
  volume: number,
  destination = state.effectsGain,
) {
  if (!state.context || !destination) return;

  const oscillator = state.context.createOscillator();
  const gain = state.context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function playNoise(state: CozyAudioState, start: number, duration: number, volume: number, cutoff: number) {
  if (!state.context || !state.effectsGain) return;

  const sampleCount = Math.floor(state.context.sampleRate * duration);
  const buffer = state.context.createBuffer(1, sampleCount, state.context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < sampleCount; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / sampleCount);
  }

  const source = state.context.createBufferSource();
  const filter = state.context.createBiquadFilter();
  const gain = state.context.createGain();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(state.effectsGain);
  source.start(start);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
