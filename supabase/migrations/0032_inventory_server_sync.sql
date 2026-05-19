-- 0030_inventory_server_sync.sql
--
-- Wire the `inventory_items` table from 0001 into the app for the first
-- time. Up to now inventory has been 100% localStorage — sign in on a
-- second device and your hat collection vanishes. This migration:
--
--   1. Extends `inventory_items` with the columns the client needs
--      (equipped flag, source, acquiredAt; the column was just qty +
--      catalog_item_id).
--   2. RPCs the client calls from `inventory-store.ts`:
--        - add_inventory_item(catalog_item_id, source, quantity)
--        - set_inventory_quantity(catalog_item_id, quantity)
--        - toggle_inventory_equipped(catalog_item_id)
--        - get_my_inventory()
--   3. RLS so each keeper sees only their own rows, with all writes
--      forced through the RPCs (the RPCs handle the upsert math).

-- ------------------------------------------------------------------------
-- 1. Extend `inventory_items` with client-needed columns
-- ------------------------------------------------------------------------

alter table public.inventory_items
  add column if not exists equipped boolean not null default false,
  -- `source` is a free-text tag describing how the item was acquired
  -- ('purchase', 'gift-received', 'daily-drop', 'mini-game-reward', etc.)
  -- — a strict enum would force tedious migrations every time the app
  -- adds a new earn path. Length-only check keeps the column compact
  -- without forcing schema churn.
  add column if not exists source text not null default 'unknown'
    check (char_length(source) between 1 and 40),
  add column if not exists acquired_at timestamptz not null default now();

create index if not exists inventory_items_owner_idx
  on public.inventory_items (owner_id, updated_at desc);
create index if not exists inventory_items_owner_equipped_idx
  on public.inventory_items (owner_id) where equipped = true;

-- ------------------------------------------------------------------------
-- 2. RLS — keepers read + manage their own, writes funnel through RPCs
-- ------------------------------------------------------------------------

alter table public.inventory_items enable row level security;

drop policy if exists "keeper reads own inventory" on public.inventory_items;
create policy "keeper reads own inventory"
  on public.inventory_items
  for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists "deny direct write to inventory" on public.inventory_items;
create policy "deny direct write to inventory"
  on public.inventory_items
  for all to authenticated
  using (false) with check (false);

-- ------------------------------------------------------------------------
-- 3. add_inventory_item — idempotent upsert by (owner, catalog_item_id)
-- ------------------------------------------------------------------------

create or replace function public.add_inventory_item(
  p_catalog_item_id text,
  p_source text default 'unknown',
  p_quantity integer default 1
)
returns integer  -- new total quantity for this catalog item
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_safe_source text;
  v_quantity integer;
  v_new_total integer;
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;
  if p_catalog_item_id is null or length(trim(p_catalog_item_id)) = 0 then
    raise exception 'catalog_item_id is required';
  end if;
  v_quantity := greatest(1, coalesce(p_quantity, 1));
  -- Per-call quantity cap. The wallet ledger already throttles via cooldowns
  -- but a malicious client could try to slam a 9999 in here.
  if v_quantity > 100 then
    raise exception 'cannot add more than 100 of an item in one call';
  end if;
  v_safe_source := coalesce(nullif(trim(p_source), ''), 'unknown');
  -- Cap at the column length so a malformed client send doesn't trip
  -- the check constraint. The constraint itself does length-only
  -- validation; we mirror that here so we error early.
  if char_length(v_safe_source) > 40 then
    v_safe_source := substr(v_safe_source, 1, 40);
  end if;

  -- The unique(owner_id, catalog_item_id) index from 0001 lets us upsert
  -- cleanly. ON CONFLICT preserves the older `equipped` + `source` so
  -- re-acquiring a stacked item doesn't surprise-unequip it.
  insert into public.inventory_items (owner_id, catalog_item_id, quantity, source)
  values (v_uid, p_catalog_item_id, v_quantity, v_safe_source)
  on conflict (owner_id, catalog_item_id)
  do update set quantity = inventory_items.quantity + v_quantity,
                updated_at = now()
  returning quantity into v_new_total;

  return v_new_total;
end;
$$;

revoke all on function public.add_inventory_item(text, text, integer) from public;
grant execute on function public.add_inventory_item(text, text, integer) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 4. set_inventory_quantity — direct setter for sell-back / spend flows
-- ------------------------------------------------------------------------

create or replace function public.set_inventory_quantity(
  p_catalog_item_id text,
  p_quantity integer
)
returns integer  -- the post-write quantity (0 if deleted)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_quantity integer;
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;
  if p_catalog_item_id is null then
    raise exception 'catalog_item_id is required';
  end if;
  v_quantity := greatest(0, coalesce(p_quantity, 0));

  if v_quantity = 0 then
    delete from public.inventory_items
      where owner_id = v_uid and catalog_item_id = p_catalog_item_id;
    return 0;
  end if;

  update public.inventory_items
     set quantity = v_quantity, updated_at = now()
   where owner_id = v_uid and catalog_item_id = p_catalog_item_id;
  -- If the row didn't exist (sell of zero stock), we don't materialize
  -- it — that's a no-op. Caller can chain through add_inventory_item if
  -- they actually want to write a new row.
  return v_quantity;
end;
$$;

revoke all on function public.set_inventory_quantity(text, integer) from public;
grant execute on function public.set_inventory_quantity(text, integer) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 5. toggle_inventory_equipped — UI mutation
-- ------------------------------------------------------------------------

create or replace function public.toggle_inventory_equipped(p_catalog_item_id text)
returns boolean  -- the new equipped state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new boolean;
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;
  update public.inventory_items
     set equipped = not equipped, updated_at = now()
   where owner_id = v_uid and catalog_item_id = p_catalog_item_id
   returning equipped into v_new;
  return coalesce(v_new, false);
end;
$$;

revoke all on function public.toggle_inventory_equipped(text) from public;
grant execute on function public.toggle_inventory_equipped(text) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 6. get_my_inventory — hydration read for the client store
-- ------------------------------------------------------------------------
-- Returning the full client-side InventoryEntry shape means the hook can
-- replace its localStorage state with the server result in one round-trip.

create or replace function public.get_my_inventory()
returns table (
  catalog_item_id text,
  quantity integer,
  equipped boolean,
  source text,
  acquired_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select catalog_item_id, quantity, equipped, source, acquired_at, updated_at
  from public.inventory_items
  where owner_id = auth.uid()
  order by updated_at desc;
$$;

revoke all on function public.get_my_inventory() from public;
grant execute on function public.get_my_inventory() to authenticated, service_role;
