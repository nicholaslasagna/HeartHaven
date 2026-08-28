-- 0090_bowling_reward_window.sql
--
-- Bowling rewards expired before a full table could finish playing.
--
-- THE ISSUE. The bowling spec is the original from 0033, written when
-- bowling was a short single-player round: max_duration_seconds = 600. The
-- game is now Moonberry Bowling, a turn-based game for up to eight players
-- (`useMiniGameSession("bowling", { maxPlayers: 8 })`) over ten frames.
--
-- claim_game_reward measures elapsed time from game_runs.started_at, and
-- startRun fires when the component MOUNTS — so the window also covers the
-- lobby wait before anyone has bowled a single ball.
--
-- The arithmetic: eight players across ten frames is roughly 128 deliveries
-- (up to 168 with strikes and spares in the tenth). Each one is an aim, a
-- swipe, the ball travelling a regulation 18.29m lane, the pins settling and
-- the turn handing over. At even ten seconds apiece that is over 1200
-- seconds — double the window — before counting time spent in the lobby.
-- Four players clear 600s too, and two players are marginal once the lobby
-- is included.
--
-- The consequence is not a small one: `v_elapsed_seconds >
-- max_duration_seconds` marks the run 'expired' and raises 'run too old', so
-- a table that just played a full twenty-five minute game is told nothing
-- and awarded nothing.
--
-- THE FIX. Size the window for the game that actually exists. 3600 seconds
-- covers eight players at a relaxed pace with the lobby included. The
-- window is a staleness guard against claiming an abandoned run, not a
-- target game length — cheating is bounded by max_score (300, a perfect
-- ten-pin game, which the `>` comparison correctly still allows) and by the
-- daily caps, neither of which this touches.
--
-- The other 0033-era specs were checked at the same time and are correctly
-- sized: memory match, garden four, petal catch, rock paper scissors and
-- fashion show all finish well inside ten minutes. Bowling is the one that
-- outgrew its spec. The specs added later already use wider windows —
-- pool and the co-op party games 900s, racing 1800s, Lantern Leap 2400s.

update public.game_reward_specs
   set max_duration_seconds = 3600,
       label = 'Moonberry Bowling'
 where game_key = 'bowling';

comment on table public.game_reward_specs is
  'Per-game reward validation. max_duration_seconds is a staleness guard measured from game_runs.started_at, which is set when the game component mounts — so it must cover the lobby wait AND the longest legitimate session at full player count, not just an average round. Sizing it to a single-player round is how bowling came to expire every multiplayer game (0090).';
