-- Phase 2 persistence bridge
--
-- Keeps the local-first HeartHaven game loop responsive while giving
-- authenticated accounts durable pets, inventory, wallet balances, and
-- furniture placement saves.

-- ------------------------------------------------------------------------
-- 1. Inventory metadata used by the client drawer/inventory views
-- ------------------------------------------------------------------------

alter table public.inventory_items
  add column if not exists equipped boolean not null default false,
  add column if not exists source text not null default 'starter';

-- Existing rows predate the source/equipped metadata.
update public.inventory_items
set source = coalesce(nullif(source, ''), 'starter')
where source is null or source = '';

-- ------------------------------------------------------------------------
-- 2. Pet roster/vitals columns
-- ------------------------------------------------------------------------

alter table public.pets
  add column if not exists client_pet_id text,
  add column if not exists accessory text not null default 'none',
  add column if not exists fullness integer not null default 80 check (fullness between 0 and 100),
  add column if not exists energy integer not null default 80 check (energy between 0 and 100),
  add column if not exists cleanliness integer not null default 80 check (cleanliness between 0 and 100),
  add column if not exists last_action_at jsonb not null default '{"feed":0,"play":0,"pamper":0,"rest":0}'::jsonb,
  add column if not exists nap_until timestamptz;

update public.pets
set
  client_pet_id = coalesce(client_pet_id, id::text),
  fullness = coalesce(fullness, greatest(0, least(100, 100 - hunger))),
  energy = coalesce(energy, 80),
  cleanliness = coalesce(cleanliness, 80),
  accessory = coalesce(nullif(accessory, ''), 'none'),
  last_action_at = coalesce(last_action_at, '{"feed":0,"play":0,"pamper":0,"rest":0}'::jsonb)
where client_pet_id is null
   or accessory is null
   or last_action_at is null;

alter table public.pets
  alter column client_pet_id set not null;

create unique index if not exists pets_owner_client_pet_id_unique
  on public.pets (owner_id, client_pet_id);

create index if not exists pets_owner_active_idx
  on public.pets (owner_id, active, updated_at desc);

-- ------------------------------------------------------------------------
-- 3. Wallet RPCs
-- ------------------------------------------------------------------------

create or replace function public.phase2_credit_wallet(
  p_game_key text,
  p_label text,
  p_score integer,
  p_coins integer,
  p_hearts integer,
  p_metadata jsonb default '{}'::jsonb
)
returns table (coins integer, hearts integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_profile is null then
    raise exception 'sign in required';
  end if;

  if p_coins < 0 or p_hearts < 0 or p_score < 0 then
    raise exception 'reward values must be non-negative';
  end if;

  insert into public.wallets (profile_id, coins, hearts)
  values (v_profile, 500, 5)
  on conflict (profile_id) do nothing;

  update public.wallets w
     set coins = w.coins + p_coins,
         hearts = w.hearts + p_hearts,
         updated_at = v_now
   where w.profile_id = v_profile
   returning w.coins, w.hearts
   into coins, hearts;

  insert into public.game_reward_events (
    profile_id,
    game_key,
    score,
    coins,
    hearts,
    metadata
  )
  values (
    v_profile,
    left(coalesce(nullif(p_game_key, ''), 'phase2-reward'), 96),
    p_score,
    p_coins,
    p_hearts,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('label', left(coalesce(p_label, 'Reward'), 120))
  );

  return next;
end;
$$;

create or replace function public.phase2_spend_wallet(
  p_coins integer,
  p_hearts integer,
  p_reason text default 'spend',
  p_metadata jsonb default '{}'::jsonb
)
returns table (ok boolean, coins integer, hearts integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := auth.uid();
  v_wallet public.wallets%rowtype;
begin
  if v_profile is null then
    raise exception 'sign in required';
  end if;

  if p_coins < 0 or p_hearts < 0 then
    raise exception 'spend values must be non-negative';
  end if;

  insert into public.wallets (profile_id, coins, hearts)
  values (v_profile, 500, 5)
  on conflict (profile_id) do nothing;

  select * into v_wallet
  from public.wallets
  where profile_id = v_profile
  for update;

  if v_wallet.coins < p_coins or v_wallet.hearts < p_hearts then
    ok := false;
    coins := v_wallet.coins;
    hearts := v_wallet.hearts;
    return next;
    return;
  end if;

  update public.wallets w
     set coins = w.coins - p_coins,
         hearts = w.hearts - p_hearts,
         updated_at = now()
   where w.profile_id = v_profile
   returning w.coins, w.hearts
   into coins, hearts;

  -- Positive-only reward ledger stays untouched; spend metadata is held in
  -- the wallet row and in application logs. This RPC is still atomic.
  ok := true;
  return next;
end;
$$;

revoke all on function public.phase2_credit_wallet(text, text, integer, integer, integer, jsonb) from public;
revoke all on function public.phase2_spend_wallet(integer, integer, text, jsonb) from public;
grant execute on function public.phase2_credit_wallet(text, text, integer, integer, integer, jsonb) to authenticated, service_role;
grant execute on function public.phase2_spend_wallet(integer, integer, text, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 4. Inventory full-state sync
-- ------------------------------------------------------------------------

create or replace function public.phase2_sync_inventory(p_items jsonb)
returns table (catalog_item_id text, quantity integer, equipped boolean, source text, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := auth.uid();
  v_count integer;
begin
  if v_profile is null then
    raise exception 'sign in required';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'inventory payload must be an array';
  end if;

  v_count := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if v_count > 400 then
    raise exception 'too many inventory rows (max 400)';
  end if;

  create temporary table if not exists pg_temp.phase2_inventory_items (
    catalog_item_id text primary key,
    quantity integer not null,
    equipped boolean not null,
    source text not null
  ) on commit drop;

  truncate pg_temp.phase2_inventory_items;

  insert into pg_temp.phase2_inventory_items (catalog_item_id, quantity, equipped, source)
  select
    left(trim(item.catalog_item_id), 128) as catalog_item_id,
    least(999, sum(greatest(0, coalesce(item.quantity, 0))))::integer as quantity,
    bool_or(coalesce(item.equipped, false)) as equipped,
    left(max(coalesce(nullif(trim(item.source), ''), 'sync')), 40) as source
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    catalog_item_id text,
    quantity integer,
    equipped boolean,
    source text
  )
  join public.catalog_items catalog on catalog.id = item.catalog_item_id
  where catalog.active = true
    and coalesce(item.quantity, 0) > 0
  group by left(trim(item.catalog_item_id), 128);

  delete from public.inventory_items server_item
  where server_item.owner_id = v_profile
    and not exists (
      select 1
      from pg_temp.phase2_inventory_items next_item
      where next_item.catalog_item_id = server_item.catalog_item_id
    );

  insert into public.inventory_items (owner_id, catalog_item_id, quantity, equipped, source)
  select v_profile, catalog_item_id, quantity, equipped, source
  from pg_temp.phase2_inventory_items
  on conflict (owner_id, catalog_item_id) do update set
    quantity = excluded.quantity,
    equipped = excluded.equipped,
    source = excluded.source,
    updated_at = now();

  return query
    select i.catalog_item_id, i.quantity, i.equipped, i.source, i.updated_at
    from public.inventory_items i
    where i.owner_id = v_profile
    order by i.updated_at desc;
end;
$$;

revoke all on function public.phase2_sync_inventory(jsonb) from public;
grant execute on function public.phase2_sync_inventory(jsonb) to authenticated, service_role;
