-- lobby_invite_polling_and_rls_verification.sql
--
-- Run from the Supabase SQL editor after applying migration 0055.
-- These checks are intentionally metadata-focused unless you set an auth
-- context in the dashboard/session, because the RPCs rely on auth.uid().

select
  'get_my_pending_place_invites_has_qualified_expiry_update' as check_name,
  pg_get_functiondef('public.get_my_pending_place_invites()'::regprocedure) like '%pending_invite.expires_at <= now()%'
    and pg_get_functiondef('public.get_my_pending_place_invites()'::regprocedure) like '%pending_invite.status = ''pending''%' as passed;

select
  'lobby_rpc_functions_exist' as check_name,
  count(*) = 3 as passed,
  array_agg(proc.proname order by proc.proname) as functions
from pg_proc proc
join pg_namespace ns on ns.oid = proc.pronamespace
where ns.nspname = 'public'
  and proc.proname in ('get_my_party_lobby', 'get_party_lobby_seats', 'set_party_lobby_ready');

select
  'lobby_rpc_functions_are_security_definer' as check_name,
  bool_and(proc.prosecdef) as passed
from pg_proc proc
join pg_namespace ns on ns.oid = proc.pronamespace
where ns.nspname = 'public'
  and proc.proname in ('get_my_party_lobby', 'get_party_lobby_seats', 'set_party_lobby_ready');

select
  'lobby_rpc_functions_granted_to_authenticated' as check_name,
  bool_and(has_function_privilege('authenticated', proc.oid, 'EXECUTE')) as passed
from pg_proc proc
join pg_namespace ns on ns.oid = proc.pronamespace
where ns.nspname = 'public'
  and proc.proname in ('get_my_party_lobby', 'get_party_lobby_seats', 'set_party_lobby_ready');

select
  'client_should_not_need_direct_lobby_reads' as check_name,
  pg_get_functiondef('public.get_my_party_lobby()'::regprocedure) like '%public.game_sessions as lobby_session%'
    and pg_get_functiondef('public.get_party_lobby_seats(uuid)'::regprocedure) like '%public.game_session_players as seated_player%' as passed;
