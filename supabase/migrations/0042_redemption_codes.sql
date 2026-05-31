-- 0042_redemption_codes.sql
--
-- Server-side redemption codes for private rewards. Raw codes are never
-- stored in the database or the public repo; admins seed SHA-256 hashes.
-- Redemptions are one-use-per-account and currently grant companion pets.

create extension if not exists pgcrypto;

create table if not exists public.redemption_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  label text not null,
  reward_type text not null default 'pet' check (reward_type in ('pet')),
  reward_pet_species text not null check (
    reward_pet_species in ('fox', 'bunny', 'bear', 'duck', 'kitten', 'puppy', 'calico', 'lamb', 'panda', 'dragon')
  ),
  reward_pet_name text not null,
  reward_pet_tone text not null default 'cream' check (reward_pet_tone in ('cream', 'blush', 'lavender', 'honey', 'sky', 'mint')),
  reward_pet_accessory text not null default 'moonberry-bow' check (
    reward_pet_accessory in ('moonberry-bow', 'lantern-scarf', 'garden-crown', 'heart-vest')
  ),
  max_global_redemptions integer check (max_global_redemptions is null or max_global_redemptions > 0),
  expires_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.redemption_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.redemption_codes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  pet_id uuid references public.pets(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  unique (code_id, user_id)
);

create index if not exists redemption_code_redemptions_user_idx
  on public.redemption_code_redemptions (user_id, redeemed_at desc);

alter table public.redemption_codes enable row level security;
alter table public.redemption_code_redemptions enable row level security;

revoke all on table public.redemption_codes from public, anon, authenticated;
revoke all on table public.redemption_code_redemptions from public, anon, authenticated;

drop policy if exists "redemption redemptions are readable by owner" on public.redemption_code_redemptions;
create policy "redemption redemptions are readable by owner"
  on public.redemption_code_redemptions
  for select
  to authenticated
  using (user_id = auth.uid());

drop function if exists public.redeem_code(text);
create function public.redeem_code(p_code text)
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
  v_uid uuid := auth.uid();
  v_code text;
  v_hash text;
  v_code_row public.redemption_codes%rowtype;
  v_existing boolean;
  v_total integer;
  v_pet_id uuid;
  v_client_pet_id text;
begin
  if v_uid is null then
    raise exception 'sign in required';
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

  v_hash := encode(digest(v_code, 'sha256'), 'hex');

  select *
    into v_code_row
    from public.redemption_codes
   where code_hash = v_hash
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
      from public.redemption_code_redemptions
     where code_id = v_code_row.id
       and user_id = v_uid
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
      from public.redemption_code_redemptions
     where code_id = v_code_row.id;

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

  update public.pets
     set active = false,
         updated_at = now()
   where owner_id = v_uid
     and active = true;

  insert into public.pets (
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
    v_uid,
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
  returning id into v_pet_id;

  insert into public.redemption_code_redemptions (code_id, user_id, pet_id)
  values (v_code_row.id, v_uid, v_pet_id);

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
grant select on public.redemption_code_redemptions to authenticated;
