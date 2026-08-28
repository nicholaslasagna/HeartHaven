-- Pool rack verification (run after 0089).
--
-- Multiplayer Pool rejected every shot: the server racked nine object balls
-- and hardcoded `jsonb_array_length(p_settled_balls) <> 10`, while the
-- client had been upgraded to a fifteen-ball triangle and submitted sixteen.
-- Every turn came back 'invalid settled ball state'.
--
-- Prerequisites: migration 0089 applied.

-- 1) THE decisive check. Expected: 16.
select jsonb_array_length(public.pool_initial_metadata(2) -> 'balls') as ball_count;

-- 2) The count must no longer be hardcoded in the validator — it derives
--    from pool_initial_metadata, so the rack has one definition.
--    Expected: derives_count = true, hardcoded_ten = false.
select
  prosrc like '%v_ball_count%' as derives_count,
  prosrc like '%<> 10%'       as hardcoded_ten
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname = 'submit_pool_shot';

-- 3) The rack must match the client's triangle exactly. Expected: no rows.
--    These coordinates were generated from createInitialPoolBalls() in
--    src/lib/game/pool-physics.ts.
with expected(id, x, y) as (
  values
    ('cue', 270.00, 290.00),
    ('ball-1', 620.00, 290.00), ('ball-2', 641.20, 277.76), ('ball-3', 641.20, 302.24),
    ('ball-4', 662.39, 265.52), ('ball-8', 662.39, 290.00), ('ball-5', 662.39, 314.48),
    ('ball-6', 683.59, 277.76), ('ball-10', 683.59, 253.28), ('ball-11', 683.59, 302.24),
    ('ball-7', 683.59, 326.72), ('ball-12', 704.79, 241.04), ('ball-9', 704.79, 265.52),
    ('ball-13', 704.79, 290.00), ('ball-14', 704.79, 314.48), ('ball-15', 704.79, 338.96)
)
select e.id,
       e.x as expected_x, (b.value->>'x')::numeric as actual_x,
       e.y as expected_y, (b.value->>'y')::numeric as actual_y
  from expected e
  full join (
    select value from jsonb_array_elements(public.pool_initial_metadata(2) -> 'balls')
  ) b on b.value->>'id' = e.id
 where b.value is null
    or e.id is null
    or abs((b.value->>'x')::numeric - e.x) > 0.02
    or abs((b.value->>'y')::numeric - e.y) > 0.02;

-- 4) Ids are unique and exactly one cue is racked. Expected: 16, 1.
select count(distinct b.value->>'id') as distinct_ids,
       count(*) filter (where b.value->>'kind' = 'cue') as cue_balls
  from jsonb_array_elements(public.pool_initial_metadata(2) -> 'balls') as b(value);

-- 5) Live sessions started before 0089 still hold a ten-ball rack and will
--    keep failing. Expected: no rows once those sessions have finished.
--    Any listed here should be cancelled or restarted.
select id, status, jsonb_array_length(metadata->'pool'->'balls') as balls
  from public.game_sessions
 where game_key = 'pool'
   and status in ('waiting', 'active')
   and jsonb_array_length(metadata->'pool'->'balls') is distinct from 16;

-- 5a) Remediation for anything query 5 lists. Those sessions store a
--     ten-ball rack in their metadata, so they stay unplayable even with
--     0089 applied — no submission can match the new count. They are
--     provably stuck rather than mid-game, since no shot could ever have
--     been accepted. Cancelling lets the lobby clear them and the players
--     start a fresh table. Left commented: it writes to live sessions, so
--     run it deliberately.
--
-- update public.game_sessions
--    set status = 'cancelled',
--        updated_at = now()
--  where game_key = 'pool'
--    and status in ('waiting', 'active')
--    and jsonb_array_length(metadata->'pool'->'balls') is distinct from 16;
