# HeartHaven multiplayer hardening — deploy verification

Use two browsers (or one normal + one incognito). Host = room/game owner. Guest = friend with edit permission where noted.

## Pre-deploy

```bash
# Link remote project (once)
supabase link --project-ref <your-project-ref>

# Apply migrations (requires Docker for local stack; remote push does not)
supabase db push
```

### Confirm migrations 0035–0042

```bash
supabase migration list
```

In Supabase SQL editor:

```sql
select version, name
  from supabase_migrations.schema_migrations
 where version in ('0035', '0036', '0037', '0038', '0039', '0040', '0041', '0042')
 order by version;
```

Expected objects (spot-check):

```sql
-- 0035
select proname from pg_proc where proname in (
  'get_room_surfaces', 'save_room_surfaces', 'get_garden_plots',
  'save_garden_plots', 'apply_garden_plot_action', 'submit_game_move'
);

-- 0036–0038 game logic
select proname from pg_proc where proname in (
  'memory_match_init_metadata', 'garden_four_detect_win'
);

-- 0037 concurrency
select proname from pg_proc where proname in (
  'commit_game_session_move', 'next_game_move_index'
);

-- 0039 surfaces
select proname from pg_proc where proname in (
  'validate_room_surface_id', 'allowed_room_floor_ids', 'allowed_room_wall_ids'
);

-- 0041 party handoff + reward lock, 0042 redemption codes
select proname from pg_proc where proname in (
  'start_party_lobby', 'claim_game_reward', 'redeem_code'
);
```

| Step | Pass criteria |
|------|----------------|
| `db push` | Exits 0, no migration errors |
| Migrations 0035–0042 | All eight rows present in `schema_migrations` |

---

## 1. Room surfaces (Browsers A + B)

**Setup:** Same host room (`/app/room` for host friend code). Guest must be `is_room_editor` (partner / decorator).

| # | Action | Expected |
|---|--------|----------|
| 1 | Host changes wallpaper | Guest UI updates within ~2s (Realtime broadcast + metadata) |
| 2 | Guest changes floor (if editor) | Host sees new floor |
| 3 | Non-editor guest tries surface change | Save fails: `not authorized to edit this room` |

**Invalid surface (SQL or REST RPC as authenticated user):**

```sql
select * from public.save_room_surfaces(
  '<HOST_FRIEND_CODE>',
  'default',
  'cream-checker',
  'not-a-real-wall',
  null  -- or current version
);
-- Expect: ERROR unknown wall surface id: not-a-real-wall
```

---

## 2. Garden plots

| # | Action | Expected |
|---|--------|----------|
| 1 | Host opens garden/park first | Plots seeded on server |
| 2 | Guest waters a plot | Host sees moisture/stage update |
| 3 | User without garden edit tries `apply_garden_plot_action` | `not authorized` (or equivalent) |

---

## 3. Garden Four party

1. Browser A: `/app/games` → start party → **Garden Four**.
2. Both open `/app/garden-four?session=<uuid>` from lobby handoff.
3. Alternate drops on own turn.

| # | Check | Expected |
|---|-------|----------|
| 1 | Wrong turn drop | `not your turn` |
| 2 | Connect four | `gameOver`, `winningCells` highlight, results overlay |
| 3 | Drop after win | `game over` |
| 4 | Claim reward | Wallet credits once; score from `metadata.finalScore` (not client coins) |
| 5 | Refresh + claim again | Idempotent / no double credit |

---

## 4. Memory Match party

1. Start from `/app/games` with `?session=` link.
2. Both on `/app/memory-match?session=<uuid>`.

| # | Check | Expected |
|---|-------|----------|
| 1 | Board layout | Same 16-card order on both clients |
| 2 | Turn | Off-turn flip rejected |
| 3 | Flips | `revealed` / `matched` sync via metadata + `game_moves` |
| 4 | Reward | Only after `gameOver`; claim requires `session_id` |

---

## 5. Party handoff

| # | Action | Expected |
|---|--------|----------|
| 1 | Host creates lobby, picks Memory Match, all seats ready, clicks Start | Host navigates to `/app/memory-match?session=<uuid>` |
| 2 | Guest receives `started` lobby event | Guest navigates to the same href with the same `session` value |
| 3 | Inspect `game_sessions.selected_game_key` | Key is canonical, e.g. `memory-match`, `garden-four`, `rock-paper-scissors`, `bowling` |
| 4 | Refresh both game pages | Both clients reload the same authoritative session state |

---

## 6. Redemption codes

Raw redemption codes must stay out of git. Seed only SHA-256 hashes in `redemption_codes`.

```sql
-- Replace <PRIVATE_CODE> locally; do not commit real codes.
select encode(digest(regexp_replace(upper('<PRIVATE_CODE>'), '[^A-Z0-9]', '', 'g'), 'sha256'), 'hex') as code_hash;
```

| # | Action | Expected |
|---|--------|----------|
| 1 | Signed-in user redeems a seeded code from `/app/pet` | New companion appears in roster and becomes active |
| 2 | Same user redeems same code again | Friendly "already redeemed" response; no duplicate `pets` row |
| 3 | Second user redeems same code | Works unless `max_global_redemptions` is exhausted |
| 4 | Expired/disabled code | No pet row inserted |

---

## 7. Abuse / edge cases

| Case | How | Expected |
|------|-----|----------|
| Double claim | Click claim twice quickly | Second call `already-claimed`, wallet unchanged |
| Wrong game route | Open memory session on garden-four URL | `This session belongs to a different game` or similar |
| Non-seated move | Third account calls `submit_game_move` | `not seated in this session` |
| Concurrent moves | Both browsers submit at once | One succeeds; other `not your turn` or `move_index_conflict` (retry ok); no duplicate `move_index` |
| Rapid double-click drop/flip | Same browser | Server serializes; state stays consistent |

**Console / network:** No unhandled errors; Supabase RPC errors show readable messages, not opaque 500s for validation.

---

## 8. Sign-off

- [ ] Migrations 0035–0042 applied on production
- [ ] Room surfaces sync + allowlist reject unknown IDs
- [ ] Garden plots sync + authorization
- [ ] Party start handoff includes `?session=<uuid>` for every seated player
- [ ] Garden Four server win + reward gate
- [ ] Memory Match authoritative board + reward gate
- [ ] No duplicate wallet rewards
- [ ] Redemption codes grant one companion per account without exposing raw codes
- [ ] No RLS errors for valid seated members

**Automated SQL helpers:** `supabase/tests/room_surface_allowlist_verification.sql`, `game_move_concurrency_verification.sql`, `garden_four_win_verification.sql`, `memory_match_verification.sql`, `redemption_code_verification.sql`
