-- Game session lifecycle verification for migration 0046.
--
-- Run only with disposable test profiles. This script uses a transaction and
-- rolls back, but it still calls SECURITY DEFINER RPCs as the configured
-- test profile.
--
-- Replace these placeholders before running:
--   00000000-0000-0000-0000-000000000001 = host profile id
--   00000000-0000-0000-0000-000000000002 = guest profile id

begin;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  if auth.uid() = '00000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'Replace placeholder profile ids before running this verification.';
  end if;
end;
$$;

-- 1. Audit the partial unique index. It must stay in place and only count
-- waiting/active rows.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'game_sessions'
  and indexname = 'game_sessions_one_active_per_host';

-- 2. Same direct game is idempotent.
create temp table lifecycle_session_ids(label text primary key, session_id uuid);

insert into lifecycle_session_ids(label, session_id)
select 'memory_1', public.ensure_play_game_session('memory-match', 2, '{"mode":"couples"}'::jsonb, null);

insert into lifecycle_session_ids(label, session_id)
select 'memory_2', public.ensure_play_game_session('memory-match', 2, '{"mode":"couples"}'::jsonb, null);

select
  'same direct Memory Match call reuses session' as check_name,
  (select session_id from lifecycle_session_ids where label = 'memory_1')
    = (select session_id from lifecycle_session_ids where label = 'memory_2') as passed;

-- 3. Direct Memory Match then direct Garden Four replaces the old solo
-- session without throwing game_sessions_one_active_per_host.
insert into lifecycle_session_ids(label, session_id)
select 'garden_1', public.ensure_play_game_session('garden-four', 2, '{}'::jsonb, null);

select
  'direct Garden Four starts after Memory Match' as check_name,
  exists (
    select 1
    from lifecycle_session_ids
    where label = 'garden_1'
      and session_id is not null
  ) as passed;

select
  'old direct Memory Match was cancelled' as check_name,
  gs.status = 'cancelled' as passed
from public.game_sessions gs
where gs.id = (select session_id from lifecycle_session_ids where label = 'memory_1');

-- 4. Completed sessions do not block new direct sessions.
update public.game_sessions
set status = 'complete', updated_at = now()
where id = (select session_id from lifecycle_session_ids where label = 'garden_1');

insert into lifecycle_session_ids(label, session_id)
select 'garden_2', public.ensure_play_game_session('garden-four', 2, '{}'::jsonb, null);

select
  'completed session does not block new session' as check_name,
  (select session_id from lifecycle_session_ids where label = 'garden_1')
    <> (select session_id from lifecycle_session_ids where label = 'garden_2') as passed;

-- 5. Exact session handoff returns the provided session id.
select
  'exact ?session handoff returns same uuid' as check_name,
  public.ensure_play_game_session(
    'garden-four',
    2,
    '{}'::jsonb,
    (select session_id from lifecycle_session_ids where label = 'garden_2')
  ) = (select session_id from lifecycle_session_ids where label = 'garden_2') as passed;

-- 6. Active party sessions with guests are not cancelled by a direct solo
-- route. This block expects a readable error and leaves the party active.
do $$
declare
  v_party_id uuid;
  v_guest_id uuid := '00000000-0000-0000-0000-000000000002'::uuid;
  v_error text;
begin
  update public.game_sessions
     set status = 'cancelled', updated_at = now()
   where host_id = auth.uid()
     and status in ('waiting', 'active');

  select session_id into v_party_id
  from public.create_party_lobby(2)
  limit 1;

  update public.game_sessions
     set selected_game_key = 'memory-match',
         selected_game_href = '/app/memory-match',
         status = 'active',
         started_at = now(),
         updated_at = now()
   where id = v_party_id;

  insert into public.game_session_players(session_id, profile_id, display_name, seat_index, team_key, ready)
  values (v_party_id, v_guest_id, 'Guest Keeper', 1, 'guest', true)
  on conflict do nothing;

  begin
    perform public.ensure_play_game_session('garden-four', 2, '{}'::jsonb, null);
  exception
    when others then
      v_error := sqlerrm;
  end;

  if coalesce(v_error, '') not like '%active party session%' then
    raise exception 'Expected active party session error, got %', coalesce(v_error, '<none>');
  end if;

  if not exists (
    select 1
    from public.game_sessions
    where id = v_party_id
      and status = 'active'
  ) then
    raise exception 'Party session was cancelled by direct solo route.';
  end if;
end;
$$;

rollback;
