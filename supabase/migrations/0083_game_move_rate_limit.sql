-- 0083_game_move_rate_limit.sql
--
-- Server-side rate limiting for `game_moves`.
--
-- Why a TRIGGER and not a check inside `submit_game_move`: that RPC is not
-- the only writer. The per-game authoritative resolvers (memory match, rock
-- paper scissors, garden four, the bowling spin wrapper) and the internal
-- `commit_move` helper all insert directly. Guarding only the RPC would
-- leave every one of those paths open, and would have to be re-applied to
-- each new resolver. The table is the chokepoint every writer passes.
--
-- Caps, per profile, across all sessions:
--   * 50 moves per 10 seconds
--   * 500 moves per 5 minutes
--
-- Sizing: `game_moves` carries DISCRETE events only — start, finish, pick,
-- drop, flip, ready, settings, coop-action. The 20Hz kart poses people might
-- worry about go over Realtime broadcast and never touch this table. The
-- fastest legitimate writer is a human tapping cards in memory match, which
-- peaks at roughly four a second in short bursts. 50/10s leaves ample room
-- above that while stopping a scripted client dead.
--
-- Service role is exempt: backend repair and migration work is trusted, and
-- is exactly the caller that might legitimately write in bulk.

create index if not exists game_moves_profile_recent_idx
  on public.game_moves (profile_id, created_at desc);

comment on index public.game_moves_profile_recent_idx is
  'Supports the per-profile rate-limit window in enforce_game_move_rate_limit(). Without it the trigger seq-scans game_moves on every insert.';

create or replace function public.enforce_game_move_rate_limit()
returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  burst_count integer;
  window_count integer;
begin
  /* Trusted backend work is not throttled. Read from the JWT claims GUC
     rather than current_user: inside a SECURITY DEFINER function current_user
     is the function OWNER, not the caller, so a role check there would always
     miss. An unset GUC (direct psql, a migration) falls through to '{}' and is
     throttled like anyone else, which fails closed. */
  if coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role'
     = 'service_role' then
    return new;
  end if;

  select count(*) into burst_count
  from public.game_moves
  where profile_id = new.profile_id
    and created_at >= now() - interval '10 seconds';

  if burst_count >= 50 then
    raise exception 'Too many game moves, slow down.'
      using errcode = '53400', hint = 'game_move_rate_limit_burst';
  end if;

  select count(*) into window_count
  from public.game_moves
  where profile_id = new.profile_id
    and created_at >= now() - interval '5 minutes';

  if window_count >= 500 then
    raise exception 'Too many game moves in a short period.'
      using errcode = '53400', hint = 'game_move_rate_limit_sustained';
  end if;

  return new;
end;
$$;

comment on function public.enforce_game_move_rate_limit() is
  'BEFORE INSERT guard on game_moves. Caps a profile at 50 moves/10s and 500/5min across all sessions, so a scripted client cannot flood the move log. SECURITY DEFINER so the count sees every row regardless of the caller RLS. Service role is exempt.';

drop trigger if exists game_move_rate_limit on public.game_moves;

create trigger game_move_rate_limit
  before insert on public.game_moves
  for each row
  execute function public.enforce_game_move_rate_limit();

revoke all on function public.enforce_game_move_rate_limit() from public;
