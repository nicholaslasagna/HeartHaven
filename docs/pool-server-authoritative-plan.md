# Moonberry Pool Multiplayer Plan

Moonberry Pool is intentionally local-first in the first playable pass. The `/app/pool?session=<uuid>` route hydrates cleanly for party handoff compatibility, but it does not claim shared multiplayer table state yet.

For a later server-authoritative Pool phase:

- Add a `submit_pool_shot` RPC or `submit_game_move` branch for `move_type = 'pool-shot'`.
- Store the full table state in `game_sessions.metadata`: ball positions, velocities, potted flags, current turn, score, shot count, and game-over state.
- Simulate each accepted shot deterministically from the submitted aim/power vector and the pre-shot metadata.
- Enforce turn ownership and reject shots while balls are resolving.
- Broadcast or poll the updated metadata so every client renders the same table, same potted balls, same score, and same next turn.
- Claim rewards from server-final score only after metadata marks the Pool session complete.
