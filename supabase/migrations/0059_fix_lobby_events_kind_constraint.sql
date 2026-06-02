-- 0059_fix_lobby_events_kind_constraint.sql
--
-- BUG: hosts could not unready, guests could not ready, and therefore the
-- host could never press Start.
--
-- ROOT CAUSE: `set_party_lobby_ready` (migration 0055) does two writes in
-- one transaction:
--   1. UPDATE game_session_players SET ready = ...   (the real state change)
--   2. INSERT INTO lobby_events (..., 'ready_changed', ...)  (realtime signal)
--
-- The lobby_events.kind CHECK constraint created back in migration 0029
-- only allowed: started, cancelled, kicked, game_selected, join_approved,
-- join_denied. `ready_changed` was never added. So write #2 raised a
-- check-constraint violation, which rolled back the ENTIRE function —
-- including write #1. The ready flag never persisted, `start_party_lobby`
-- always saw `v_ready < v_occupied`, and Start stayed disabled.
--
-- This is the third time a new lobby RPC has introduced a `kind` value the
-- frozen 2029 enum didn't know about (game_selected, join_*, now
-- ready_changed). Rather than chase the enum forever — and risk a future
-- RPC silently rolling back real state again — we replace the brittle
-- value-list CHECK with a resilient SHAPE check. Any lowercase snake_case
-- token up to 40 chars is now accepted. An audit-log row can never again
-- veto a gameplay state change.
--
-- We still keep a CHECK (not "no constraint") so genuinely malformed kinds
-- (empty string, injection-y payloads) are rejected.

do $$
declare
  v_constraint_name text;
begin
  -- Find whatever the existing CHECK constraint on lobby_events.kind is
  -- named (Postgres auto-names inline column checks `<table>_<col>_check`,
  -- but we look it up defensively in case it differs) and drop it.
  for v_constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'lobby_events'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format('alter table public.lobby_events drop constraint %I', v_constraint_name);
  end loop;

  -- Add the resilient shape check under a stable, known name.
  alter table public.lobby_events
    add constraint lobby_events_kind_shape_check
    check (kind ~ '^[a-z][a-z0-9_]{0,39}$');
end $$;

comment on constraint lobby_events_kind_shape_check on public.lobby_events is
  'Resilient shape check (lowercase snake_case, <=40 chars) replacing the original frozen value-list. Prevents a new event kind from a future RPC from rolling back the state change it accompanies.';
