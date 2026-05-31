-- Redemption code verification for 0042.
--
-- Do not commit real production redemption codes. Use this file as a
-- checklist in the SQL editor with throwaway private test codes only.

-- 1) Confirm objects exist.
select to_regclass('public.redemption_codes') as redemption_codes_table,
       to_regclass('public.redemption_code_redemptions') as redemption_code_redemptions_table;

select p.proname,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'redeem_code';

-- Expected:
-- security_definer=true
-- anon_can_execute=false
-- authenticated_can_execute=true

-- 2) Confirm raw plaintext codes are not modeled or stored.
select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'redemption_codes'
   and column_name in ('code', 'raw_code', 'plaintext_code');
-- Expected: zero rows.

select count(*) as non_sha256_hash_rows
  from public.redemption_codes
 where code_hash !~ '^[0-9a-f]{64}$';
-- Expected: 0.

-- 3) Confirm users cannot write redemption tables directly.
select has_table_privilege('anon', 'public.redemption_codes', 'insert') as anon_can_insert_codes,
       has_table_privilege('authenticated', 'public.redemption_codes', 'insert') as authenticated_can_insert_codes,
       has_table_privilege('anon', 'public.redemption_code_redemptions', 'insert') as anon_can_insert_redemptions,
       has_table_privilege('authenticated', 'public.redemption_code_redemptions', 'insert') as authenticated_can_insert_redemptions;
-- Expected: all false.

-- 4) Admin-only seed example. Replace HH-DEV-EXAMPLE-CASPER locally with a
-- private throwaway code before running. Never commit real production codes.
-- Service role / SQL editor only:
/*
with private_code as (
  select regexp_replace(upper('HH-DEV-EXAMPLE-CASPER'), '[^A-Z0-9]', '', 'g') as normalized
)
insert into public.redemption_codes (
  code_hash,
  label,
  reward_pet_species,
  reward_pet_name,
  reward_pet_tone,
  reward_pet_accessory,
  max_global_redemptions,
  expires_at
)
select
  encode(digest(normalized, 'sha256'), 'hex'),
  'Developer test Casper companion',
  'calico',
  'Casper',
  'cream',
  'moonberry-bow',
  1,
  now() + interval '1 day'
from private_code
on conflict (code_hash) do update
  set label = excluded.label,
      reward_pet_species = excluded.reward_pet_species,
      reward_pet_name = excluded.reward_pet_name,
      reward_pet_tone = excluded.reward_pet_tone,
      reward_pet_accessory = excluded.reward_pet_accessory,
      max_global_redemptions = excluded.max_global_redemptions,
      expires_at = excluded.expires_at,
      disabled_at = null;
*/

-- 5) Authenticated redemption test. Run as a signed-in user via /app/pet or
-- the Supabase SQL editor impersonation tools:
-- select * from public.redeem_code('HH-DEV-EXAMPLE-CASPER');
-- Expected: ok=true; public.pets gets one active row with the seeded species,
-- name, tone, and accessory. The client cannot provide these reward fields.

-- 6) Same user redeeming again:
-- select * from public.redeem_code('HH-DEV-EXAMPLE-CASPER');
-- Expected: ok=false, message='You already redeemed this code.'

-- 7) Confirm no duplicate redemption row was created for that user/code.
-- select count(*)
--   from public.redemption_code_redemptions
--  where user_id = auth.uid()
--    and code_id = (
--      select id
--        from public.redemption_codes
--       where code_hash = encode(digest(regexp_replace(upper('HH-DEV-EXAMPLE-CASPER'), '[^A-Z0-9]', '', 'g'), 'sha256'), 'hex')
--    );
-- Expected: 1.

-- 8) Expired code should fail and not insert a pet.
/*
with private_code as (
  select regexp_replace(upper('HH-DEV-EXPIRED-CASPER'), '[^A-Z0-9]', '', 'g') as normalized
)
insert into public.redemption_codes (
  code_hash, label, reward_pet_species, reward_pet_name, reward_pet_tone,
  reward_pet_accessory, expires_at
)
select encode(digest(normalized, 'sha256'), 'hex'), 'Expired test', 'calico', 'Casper', 'cream', 'moonberry-bow', now() - interval '1 minute'
from private_code
on conflict (code_hash) do update set expires_at = excluded.expires_at, disabled_at = null;

-- As authenticated user:
-- select * from public.redeem_code('HH-DEV-EXPIRED-CASPER');
-- Expected: ok=false, message='That code has expired.'
*/

-- 9) Disabled code should fail and not insert a pet.
/*
with private_code as (
  select regexp_replace(upper('HH-DEV-DISABLED-CASPER'), '[^A-Z0-9]', '', 'g') as normalized
)
insert into public.redemption_codes (
  code_hash, label, reward_pet_species, reward_pet_name, reward_pet_tone,
  reward_pet_accessory, disabled_at
)
select encode(digest(normalized, 'sha256'), 'hex'), 'Disabled test', 'calico', 'Casper', 'cream', 'moonberry-bow', now()
from private_code
on conflict (code_hash) do update set disabled_at = excluded.disabled_at;

-- As authenticated user:
-- select * from public.redeem_code('HH-DEV-DISABLED-CASPER');
-- Expected: ok=false, message='That code is no longer active.'
*/

-- 10) Max global redemption test.
-- Seed HH-DEV-EXAMPLE-CASPER with max_global_redemptions=1, redeem from user A,
-- then redeem from user B. User B should receive:
-- ok=false, message='That code has already been fully claimed.'
