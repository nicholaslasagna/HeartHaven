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

select
  p.prosrc like '%extensions.digest%' as redeem_code_uses_schema_qualified_pgcrypto,
  p.prosrc !~ '(^|[^.])\mdigest\s*\(' as no_obvious_unqualified_digest_pattern
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'redeem_code';
-- Expected after 0050: redeem_code_uses_schema_qualified_pgcrypto=true.

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

-- 3) Confirm ownership FKs point at profiles, matching public.pets.owner_id.
select
  constraint_name,
  table_name,
  column_name,
  foreign_table_name,
  foreign_column_name
from (
  select
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name as foreign_table_name,
    ccu.column_name as foreign_column_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
   and kcu.constraint_schema = tc.constraint_schema
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name
   and ccu.constraint_schema = tc.constraint_schema
  where tc.constraint_schema = 'public'
    and tc.constraint_type = 'FOREIGN KEY'
) fk
where (table_name = 'pets' and column_name = 'owner_id')
   or (table_name = 'redemption_code_redemptions' and column_name = 'user_id')
order by table_name, column_name;
-- Expected:
-- pets.owner_id -> profiles.id
-- redemption_code_redemptions.user_id -> profiles.id

-- 4) Confirm users cannot write redemption tables directly.
select has_table_privilege('anon', 'public.redemption_codes', 'insert') as anon_can_insert_codes,
       has_table_privilege('authenticated', 'public.redemption_codes', 'insert') as authenticated_can_insert_codes,
       has_table_privilege('anon', 'public.redemption_code_redemptions', 'insert') as anon_can_insert_redemptions,
       has_table_privilege('authenticated', 'public.redemption_code_redemptions', 'insert') as authenticated_can_insert_redemptions;
-- Expected: all false.

-- 5) Admin-only seed example. Replace HH-DEV-EXAMPLE-CASPER locally with a
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
  encode(extensions.digest(normalized, 'sha256'), 'hex'),
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

-- 6) Authenticated redemption test. Run as a signed-in user via /app/pet or
-- the Supabase SQL editor impersonation tools:
-- select * from public.redeem_code('HH-DEV-EXAMPLE-CASPER');
-- Expected: ok=true; public.pets gets one active row with the seeded species,
-- name, tone, and accessory. The client cannot provide these reward fields.

-- Confirm the pet was inserted for the caller's profile owner, not an
-- arbitrary client-supplied owner. Run this from the same impersonated
-- authenticated user after the successful redemption above.
/*
with private_code as (
  select encode(
    extensions.digest(regexp_replace(upper('HH-DEV-EXAMPLE-CASPER'), '[^A-Z0-9]', '', 'g'), 'sha256'
  ), 'hex') as code_hash
),
redeemed as (
  select r.*
  from public.redemption_code_redemptions r
  join public.redemption_codes c on c.id = r.code_id
  join private_code pc on pc.code_hash = c.code_hash
  where r.user_id = auth.uid()
  order by r.redeemed_at desc
  limit 1
)
select
  auth.uid() as current_auth_uid,
  redeemed.user_id as redemption_profile_id,
  pets.owner_id as pet_owner_profile_id,
  pets.species,
  pets.name,
  pets.tone,
  pets.accessory
from redeemed
join public.pets on pets.id = redeemed.pet_id;
*/
-- Expected: current_auth_uid = redemption_profile_id = pet_owner_profile_id.

-- 7) Same user redeeming again:
-- select * from public.redeem_code('HH-DEV-EXAMPLE-CASPER');
-- Expected: ok=false, message='You already redeemed this code.'

-- 8) Confirm no duplicate redemption row was created for that user/code.
-- select count(*)
--   from public.redemption_code_redemptions
--  where user_id = auth.uid()
--    and code_id = (
--      select id
--        from public.redemption_codes
--       where code_hash = encode(extensions.digest(regexp_replace(upper('HH-DEV-EXAMPLE-CASPER'), '[^A-Z0-9]', '', 'g'), 'sha256'), 'hex')
--    );
-- Expected: 1.

-- 9) Expired code should fail and not insert a pet.
/*
with private_code as (
  select regexp_replace(upper('HH-DEV-EXPIRED-CASPER'), '[^A-Z0-9]', '', 'g') as normalized
)
insert into public.redemption_codes (
  code_hash, label, reward_pet_species, reward_pet_name, reward_pet_tone,
  reward_pet_accessory, expires_at
)
select encode(extensions.digest(normalized, 'sha256'), 'hex'), 'Expired test', 'calico', 'Casper', 'cream', 'moonberry-bow', now() - interval '1 minute'
from private_code
on conflict (code_hash) do update set expires_at = excluded.expires_at, disabled_at = null;

-- As authenticated user:
-- select * from public.redeem_code('HH-DEV-EXPIRED-CASPER');
-- Expected: ok=false, message='That code has expired.'
*/

-- 10) Disabled code should fail and not insert a pet.
/*
with private_code as (
  select regexp_replace(upper('HH-DEV-DISABLED-CASPER'), '[^A-Z0-9]', '', 'g') as normalized
)
insert into public.redemption_codes (
  code_hash, label, reward_pet_species, reward_pet_name, reward_pet_tone,
  reward_pet_accessory, disabled_at
)
select encode(extensions.digest(normalized, 'sha256'), 'hex'), 'Disabled test', 'calico', 'Casper', 'cream', 'moonberry-bow', now()
from private_code
on conflict (code_hash) do update set disabled_at = excluded.disabled_at;

-- As authenticated user:
-- select * from public.redeem_code('HH-DEV-DISABLED-CASPER');
-- Expected: ok=false, message='That code is no longer active.'
*/

-- 11) Max global redemption test.
-- Seed HH-DEV-EXAMPLE-CASPER with max_global_redemptions=1, redeem from user A,
-- then redeem from user B. User B should receive:
-- ok=false, message='That code has already been fully claimed.'

-- 12) Admin-only Super Snails example. Replace HH-DEV-SUPER-SNAILS with a
-- private throwaway code before running. This is intentionally not a real
-- production code. To test a real live Super Snails code, paste it only in
-- the Supabase SQL editor or /app/pet UI; do not save it in this repo.
/*
with private_code as (
  select regexp_replace(upper('HH-DEV-SUPER-SNAILS'), '[^A-Z0-9]', '', 'g') as normalized
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
  encode(extensions.digest(normalized, 'sha256'), 'hex'),
  'Developer test Super Snails companion',
  'super-snails',
  'Super Snails',
  'cream',
  'heart-vest',
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

-- As authenticated user:
-- select * from public.redeem_code('HH-DEV-SUPER-SNAILS');
-- Expected: ok=true, reward_pet_species='super-snails', reward_pet_name='Super Snails';
-- the app shows the unlock celebration and Super Snails appears in the companion roster.

-- Confirm Super Snails ownership after redeeming the private test/live code:
-- select owner_id, species, name, tone, accessory, active
--   from public.pets
--  where owner_id = auth.uid()
--    and species = 'super-snails'
--  order by created_at desc
--  limit 1;
-- Expected: owner_id = auth.uid(), species='super-snails', active=true.

-- 13) Real Super Snails row check. Do not paste the real code into this
-- file. In the SQL editor only, replace <PRIVATE_SUPER_SNAILS_CODE> with
-- the live code and run:
/*
with private_code as (
  select encode(
    extensions.digest(regexp_replace(upper('<PRIVATE_SUPER_SNAILS_CODE>'), '[^A-Z0-9]', '', 'g'), 'sha256'),
    'hex'
  ) as code_hash
)
select
  c.label,
  c.reward_pet_species,
  c.reward_pet_name,
  c.reward_pet_tone,
  c.reward_pet_accessory,
  c.disabled_at,
  c.expires_at,
  c.max_global_redemptions
from public.redemption_codes c
join private_code pc on pc.code_hash = c.code_hash;
*/
-- Expected for the live code:
-- reward_pet_species='super-snails'
-- reward_pet_tone='sky'
-- reward_pet_accessory='lantern-scarf'
-- disabled_at is null
