-- 0057_fix_phase2_inventory_sync_ambiguity.sql
-- Qualify temp-table columns in phase2_sync_inventory. PL/pgSQL output
-- parameters are variables, so bare catalog_item_id/quantity/equipped/source
-- can become ambiguous inside SELECT statements.

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
  select
    v_profile,
    next_item.catalog_item_id,
    next_item.quantity,
    next_item.equipped,
    next_item.source
  from pg_temp.phase2_inventory_items next_item
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
