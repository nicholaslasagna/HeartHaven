# Moonberry Pool Multiplayer Plan

Moonberry Pool supports two modes:

- `/app/pool` is solo/local Pool.
- `/app/pool?session=<uuid>` is synchronized party Pool.

The synchronized v1 uses the safe compromise from the product spec: the active client runs the deterministic TypeScript physics until balls settle, then calls `submit_pool_shot`. The server validates membership, turn ownership, power/angle bounds, settled ball schema, table bounds, cue reset, and score math before storing the canonical table in `game_sessions.metadata->pool`.

Every client renders from that canonical metadata:

- ball positions
- potted flags
- current turn
- per-seat scores
- shot count
- game-over state
- final reward score

Rewards for shared Pool require the completed session id; `claim_game_reward` reads the final score from the session metadata and blocks repeat claims for the same keeper/session.

For a later fully server-simulated Pool phase:

- Simulate each accepted shot deterministically from the submitted aim/power vector and the pre-shot metadata.
- Move physics from the client to a trusted edge/server function or deterministic SQL-safe helper.
- Store only the shot command in `game_moves`; derive settled table state server-side.
- Keep the current metadata shape so clients do not need another rendering rewrite.
