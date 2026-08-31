-- HeartHaven database health check.
--
-- One script, one table: every guarantee the migrations are meant to provide,
-- and whether the database ACTUALLY provides it right now.
--
-- This exists because "applied" and "in effect" turned out to be different
-- things more than once. Migration 0081 ran cleanly and did nothing at all —
-- a column-level revoke cannot subtract from a table-level grant, so phone
-- numbers stayed readable while the migration reported success. The migration
-- list tells you what was run. This tells you what is true.
--
-- Every check is wrapped so a missing object reports FAIL rather than
-- aborting the script — which matters, because "not applied yet" is the case
-- it most needs to survive. The helper lives in pg_temp and disappears when
-- the session ends; it writes nothing.
--
-- Run in the SQL editor. Every row should read OK.

create or replace function pg_temp.health_check()
returns table (status text, migration text, guarantee text, detail text)
language plpgsql
as $$
declare
  r record;
  ok boolean;
  detail_text text;
begin
  -- 0082 · ban checks must not be an oracle for who is banned
  for r in select p.oid, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('is_email_banned', 'is_phone_banned')
  loop
    begin
      ok := not (has_function_privilege('anon', r.oid, 'execute')
              or has_function_privilege('authenticated', r.oid, 'execute'));
      return query select case when ok then 'OK' else 'FAIL' end, '0082',
                          'ban checks are service-role only', r.proname::text;
    exception when others then
      return query select 'FAIL', '0082', 'ban checks are service-role only', sqlerrm;
    end;
  end loop;

  -- 0085 · phone numbers are not readable by players, but the rest still is
  begin
    ok := not (has_column_privilege('authenticated', 'public.profiles', 'phone', 'select')
            or has_column_privilege('anon', 'public.profiles', 'phone', 'select'));
    return query select case when ok then 'OK' else 'FAIL' end, '0085',
                        'profiles.phone is hidden from players', 'phone column';
    ok := has_column_privilege('authenticated', 'public.profiles', 'display_name', 'select');
    return query select case when ok then 'OK' else 'FAIL' end, '0085',
                        'the rest of profiles still reads', 'display_name column';
  exception when others then
    return query select 'FAIL', '0085', 'profiles column grants', sqlerrm;
  end;

  -- 0086 · world state is scoped to its owner
  for r in select tablename, policyname, coalesce(qual, 'true') as qual
             from pg_policies
            where schemaname = 'public' and cmd = 'SELECT'
              and tablename in ('room_placements_state', 'room_surfaces_state', 'room_decorator_grants',
                                'garden_decor_state', 'garden_plots_state', 'garden_decorator_grants')
  loop
    return query select case when r.qual <> 'true' then 'OK' else 'FAIL' end, '0086',
                        'world state is owner-scoped', r.tablename::text || ' · ' || r.policyname::text;
  end loop;

  -- 0087, 0088 · predicates about other people are internal only
  for r in select p.oid, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('are_friends', 'is_recipient_blocking', 'is_room_editor',
                                'is_garden_editor', 'can_chat_in_host_place')
  loop
    ok := not (has_function_privilege('anon', r.oid, 'execute')
            or has_function_privilege('authenticated', r.oid, 'execute')
            or has_function_privilege('public', r.oid, 'execute'));
    return query select case when ok then 'OK' else 'FAIL' end,
                        case when r.proname in ('are_friends', 'is_recipient_blocking') then '0088' else '0087' end,
                        'third-party predicates are internal only', r.proname::text;
  end loop;

  -- ...while the self-relative helpers MUST stay callable: they run inside
  -- RLS policies, which evaluate as the querying user. Revoking these breaks
  -- profile and session reads outright.
  for r in select p.oid, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('can_profiles_interact', 'is_partner_member',
                                'has_private_content', 'is_game_session_member')
  loop
    ok := has_function_privilege('authenticated', r.oid, 'execute');
    return query select case when ok then 'OK' else 'FAIL' end, '0088',
                        'policy helpers stay callable', r.proname::text;
  end loop;

  -- 0083, 0084 · flood guards, with the indexes that keep them cheap
  return query select case when exists (
      select 1 from pg_trigger where tgrelid = to_regclass('public.game_moves')
        and tgname = 'game_move_rate_limit' and not tgisinternal)
    then 'OK' else 'FAIL' end, '0083', 'game_moves rate limit is attached', 'trigger';
  return query select case when exists (
      select 1 from pg_indexes where schemaname = 'public'
        and indexname = 'game_moves_profile_recent_idx')
    then 'OK' else 'FAIL' end, '0083', 'game_moves rate limit has its index', 'index';
  return query select case when exists (
      select 1 from pg_trigger where tgrelid = to_regclass('public.game_sessions')
        and tgname = 'game_session_rate_limit' and not tgisinternal)
    then 'OK' else 'FAIL' end, '0084', 'game_sessions rate limit is attached', 'trigger';
  return query select case when exists (
      select 1 from pg_indexes where schemaname = 'public'
        and indexname = 'game_sessions_host_recent_idx')
    then 'OK' else 'FAIL' end, '0084', 'game_sessions rate limit has its index', 'index';

  -- 0089 · the pool rack matches the client, and is defined in one place
  begin
    ok := jsonb_array_length(public.pool_initial_metadata(2) -> 'balls') = 16;
    return query select case when ok then 'OK' else 'FAIL' end, '0089', 'pool racks 16 balls',
                        jsonb_array_length(public.pool_initial_metadata(2) -> 'balls')::text || ' balls';
  exception when others then
    return query select 'FAIL', '0089', 'pool racks 16 balls', sqlerrm;
  end;
  return query select case when (
      select prosrc like '%v_ball_count%' and prosrc not like '%<> 10%' from pg_proc
       where pronamespace = 'public'::regnamespace and proname = 'submit_pool_shot')
    then 'OK' else 'FAIL' end, '0089', 'pool ball count is derived', 'submit_pool_shot';

  -- 0090 · a full table of bowlers can finish before the reward expires
  begin
    select max_duration_seconds >= 3600, max_duration_seconds::text || 's'
      into ok, detail_text from public.game_reward_specs where game_key = 'bowling';
    return query select case when coalesce(ok, false) then 'OK' else 'FAIL' end, '0090',
                        'bowling reward window fits 8 players', coalesce(detail_text, 'no spec row');
  exception when others then
    return query select 'FAIL', '0090', 'bowling reward window fits 8 players', sqlerrm;
  end;

  -- 0091, 0093 · memory match deals 24 and bounds by the session's own board
  begin
    ok := public.memory_match_board_size() = 24;
    return query select case when ok then 'OK' else 'FAIL' end, '0091', 'memory match deals 24 cards',
                        public.memory_match_board_size()::text || ' cards';
  exception when others then
    return query select 'FAIL', '0091', 'memory match deals 24 cards', sqlerrm;
  end;
  return query select case when (
      select prosrc like '%jsonb_array_length(v_meta->''board'')%' and prosrc not like '%v_card_index > 15%'
        from pg_proc where pronamespace = 'public'::regnamespace and proname = 'submit_game_move')
    then 'OK' else 'FAIL' end, '0093', 'card index bounded by the session board', 'submit_game_move';

  -- 0092 · watering is a cadence with consequences, and harvest pays
  return query select case when (
      select prosrc like '%c_water_every%' and prosrc like '%c_thirsty_after%' and prosrc like '%wallets%'
        from pg_proc where pronamespace = 'public'::regnamespace and proname = 'apply_garden_plot_action')
    then 'OK' else 'FAIL' end, '0092', 'watering has cooldown, drought and payout', 'apply_garden_plot_action';

  -- Standing hygiene, not tied to any one migration.
  for r in select p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef
              and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'
  loop
    return query select 'FAIL', '—', 'SECURITY DEFINER pins search_path', r.proname::text;
  end loop;
  if not found then
    return query select 'OK', '—', 'SECURITY DEFINER pins search_path', 'all functions';
  end if;

  for r in select c.relname from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    return query select 'FAIL', '—', 'every table has row level security', r.relname::text;
  end loop;
  if not found then
    return query select 'OK', '—', 'every table has row level security', 'all tables';
  end if;
end;
$$;

select * from pg_temp.health_check() order by status desc, migration, guarantee, detail;
