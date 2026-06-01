-- 0050_redeem_code_pgcrypto_schema.sql
--
-- Production fix: redeem_code runs as SECURITY DEFINER with
-- `set search_path = public`. On Supabase projects where pgcrypto is
-- installed in the `extensions` schema, an unqualified `digest(...)`
-- cannot be resolved from that restricted search path. Keep ownership
-- semantics from 0049, but schema-qualify pgcrypto calls.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.redeem_code(p_code text)
returns table (
  ok boolean,
  code_label text,
  reward_type text,
  reward_pet_species text,
  reward_pet_name text,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_profile_id uuid;
  v_display_name text;
  v_code text;
  v_hash text;
  v_code_row public.redemption_codes%rowtype;
  v_existing boolean;
  v_total integer;
  v_pet_id uuid;
  v_client_pet_id text;
begin
  if v_auth_uid is null then
    raise exception 'sign in required';
  end if;

  select profile.id
    into v_profile_id
    from public.profiles as profile
   where profile.id = v_auth_uid
   limit 1;

  if v_profile_id is null then
    select substr(coalesce(nullif(split_part(auth_user.email, '@', 1), ''), auth_user.id::text), 1, 24)
      into v_display_name
      from auth.users as auth_user
     where auth_user.id = v_auth_uid
     limit 1;

    if v_display_name is not null then
      insert into public.profiles (id, display_name)
      values (v_auth_uid, v_display_name)
      on conflict (id) do nothing;

      select profile.id
        into v_profile_id
        from public.profiles as profile
       where profile.id = v_auth_uid
       limit 1;
    end if;
  end if;

  if v_profile_id is null then
    ok := false;
    code_label := null;
    reward_type := null;
    reward_pet_species := null;
    reward_pet_name := null;
    message := 'Your HeartHaven profile is still being prepared. Refresh and try again.';
    return next;
    return;
  end if;

  v_code := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
  if length(v_code) < 6 then
    ok := false;
    code_label := null;
    reward_type := null;
    reward_pet_species := null;
    reward_pet_name := null;
    message := 'Enter a valid HeartHaven code.';
    return next;
    return;
  end if;

  v_hash := encode(extensions.digest(v_code, 'sha256'), 'hex');

  select redemption_code.*
    into v_code_row
    from public.redemption_codes as redemption_code
   where redemption_code.code_hash = v_hash
   for update;

  if v_code_row.id is null then
    ok := false;
    code_label := null;
    reward_type := null;
    reward_pet_species := null;
    reward_pet_name := null;
    message := 'That code was not found.';
    return next;
    return;
  end if;

  if v_code_row.disabled_at is not null then
    ok := false;
    code_label := v_code_row.label;
    reward_type := v_code_row.reward_type;
    reward_pet_species := v_code_row.reward_pet_species;
    reward_pet_name := v_code_row.reward_pet_name;
    message := 'That code is no longer active.';
    return next;
    return;
  end if;

  if v_code_row.expires_at is not null and v_code_row.expires_at <= now() then
    ok := false;
    code_label := v_code_row.label;
    reward_type := v_code_row.reward_type;
    reward_pet_species := v_code_row.reward_pet_species;
    reward_pet_name := v_code_row.reward_pet_name;
    message := 'That code has expired.';
    return next;
    return;
  end if;

  select exists (
    select 1
      from public.redemption_code_redemptions as redemption
     where redemption.code_id = v_code_row.id
       and redemption.user_id = v_profile_id
  ) into v_existing;

  if v_existing then
    ok := false;
    code_label := v_code_row.label;
    reward_type := v_code_row.reward_type;
    reward_pet_species := v_code_row.reward_pet_species;
    reward_pet_name := v_code_row.reward_pet_name;
    message := 'You already redeemed this code.';
    return next;
    return;
  end if;

  if v_code_row.max_global_redemptions is not null then
    select count(*)::integer
      into v_total
      from public.redemption_code_redemptions as redemption
     where redemption.code_id = v_code_row.id;

    if v_total >= v_code_row.max_global_redemptions then
      ok := false;
      code_label := v_code_row.label;
      reward_type := v_code_row.reward_type;
      reward_pet_species := v_code_row.reward_pet_species;
      reward_pet_name := v_code_row.reward_pet_name;
      message := 'That code has already been fully claimed.';
      return next;
      return;
    end if;
  end if;

  v_client_pet_id := 'redeemed-' || v_code_row.id::text;

  update public.pets as pet
     set active = false,
         updated_at = now()
   where pet.owner_id = v_profile_id
     and pet.active = true;

  insert into public.pets as inserted_pet (
    owner_id,
    client_pet_id,
    species,
    name,
    tone,
    accessory,
    active,
    happiness,
    hunger,
    fullness,
    energy,
    cleanliness
  )
  values (
    v_profile_id,
    v_client_pet_id,
    v_code_row.reward_pet_species,
    v_code_row.reward_pet_name,
    v_code_row.reward_pet_tone,
    v_code_row.reward_pet_accessory,
    true,
    90,
    10,
    90,
    88,
    88
  )
  returning inserted_pet.id into v_pet_id;

  insert into public.redemption_code_redemptions (code_id, user_id, pet_id)
  values (v_code_row.id, v_profile_id, v_pet_id);

  ok := true;
  code_label := v_code_row.label;
  reward_type := v_code_row.reward_type;
  reward_pet_species := v_code_row.reward_pet_species;
  reward_pet_name := v_code_row.reward_pet_name;
  message := v_code_row.reward_pet_name || ' joined your companion roster.';
  return next;
end;
$$;

revoke all on function public.redeem_code(text) from public;
grant execute on function public.redeem_code(text) to authenticated, service_role;
