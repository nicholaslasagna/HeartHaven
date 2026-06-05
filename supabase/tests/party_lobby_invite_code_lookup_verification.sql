-- Verification for 0061_party_lobby_invite_code_lookup.sql.
--
-- Run in Supabase SQL editor using two authenticated users if possible:
-- 1. Host: create lobby and note invite_code + host_friend_code.
-- 2. Guest: request_join_party(invite_code) must create one pending request.
-- 3. Guest: request_join_party(host_friend_code) must return the same pending request
--    or null if already seated, not "no active lobby for that code".
--
-- Function definitions should accept both host_friend_code and invite_code.
select
  proc.proname,
  pg_get_functiondef(proc.oid) ilike '%lobby_session.invite_code = v_code%' as find_checks_invite_code,
  pg_get_functiondef(proc.oid) ilike '%lobby_session.invite_code = v_join_code%' as request_checks_invite_code
from pg_proc as proc
join pg_namespace as nsp on nsp.oid = proc.pronamespace
where nsp.nspname = 'public'
  and proc.proname in ('find_party_lobby', 'request_join_party')
order by proc.proname;

-- Existing pending requests should stay unique per session/requester.
select
  con.conname,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint as con
join pg_class as rel on rel.oid = con.conrelid
join pg_namespace as nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'lobby_join_requests'
  and con.contype in ('u', 'p')
order by con.conname;
