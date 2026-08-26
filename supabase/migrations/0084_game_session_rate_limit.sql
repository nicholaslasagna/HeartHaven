-- 0084_game_session_rate_limit.sql
--
-- Server-side rate limiting for `game_sessions`, the companion to the
-- `game_moves` cap in 0083.
--
-- Same reasoning for using a TRIGGER: sessions are created from several
-- places (the party lobby in 0029, the generic opener in 0035, the memory
-- match resolvers in 0036, the invite-code repair in 0043). Guarding one
-- would leave the rest open. The table is where they all meet.
--
-- Caps, per host:
--   * 25 sessions per minute
--   * 150 sessions per hour
--
-- Sizing is deliberately loose. A session is created when someone opens a
-- game, and a player browsing the hub or rematching quickly can legitimately
-- open several in a row — plus React StrictMode double-mounts effects in
-- development. 25/minute is one every 2.4 seconds sustained, well past
-- anything a person does with a mouse, while still stopping a script from
-- filling the table.
--
-- Service role is exempt, as in 0083.

create index if not exists game_sessions_host_recent_idx
  on public.game_sessions (host_id, created_at desc);

comment on index public.game_sessions_host_recent_idx is
  'Supports the per-host rate-limit window in enforce_game_session_rate_limit(). Without it the trigger seq-scans game_sessions on every insert.';

create or replace function public.enforce_game_session_rate_limit()
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
     rather than current_user, which inside a SECURITY DEFINER function is
     the function OWNER rather than the caller. An unset GUC falls through
     and is throttled, which fails closed. */
  if coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role'
     = 'service_role' then
    return new;
  end if;

  select count(*) into burst_count
  from public.game_sessions
  where host_id = new.host_id
    and created_at >= now() - interval '1 minute';

  if burst_count >= 25 then
    raise exception 'Too many games opened at once, take a breath.'
      using errcode = '53400', hint = 'game_session_rate_limit_burst';
  end if;

  select count(*) into window_count
  from public.game_sessions
  where host_id = new.host_id
    and created_at >= now() - interval '1 hour';

  if window_count >= 150 then
    raise exception 'Too many games opened in the last hour.'
      using errcode = '53400', hint = 'game_session_rate_limit_sustained';
  end if;

  return new;
end;
$$;

comment on function public.enforce_game_session_rate_limit() is
  'BEFORE INSERT guard on game_sessions. Caps a host at 25 sessions/minute and 150/hour so a scripted client cannot fill the table. SECURITY DEFINER so the count sees every row regardless of caller RLS. Service role is exempt.';

drop trigger if exists game_session_rate_limit on public.game_sessions;

create trigger game_session_rate_limit
  before insert on public.game_sessions
  for each row
  execute function public.enforce_game_session_rate_limit();

revoke all on function public.enforce_game_session_rate_limit() from public;
