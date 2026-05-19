-- 0034_partner_linking.sql
--
-- Partner linking RPCs + realtime publication. The `partner_links` table
-- itself was created in migration 0001 with status + RLS already wired
-- up, but no app code reads/writes it. This migration adds:
--
--   • request_partner_link(target_friend_code)   — Alice asks Bob
--   • respond_partner_link(link_id, accept)      — Bob accepts/declines
--   • unlink_partner()                           — either side ends it
--   • get_my_partner()                           — read current state
--
-- All four are SECURITY DEFINER + auth.uid()-gated so the client never
-- needs raw INSERT permission. Realtime publication is enabled so Bob's
-- tab sees Alice's request the moment it lands.

-- ------------------------------------------------------------------------
-- 1. request_partner_link — Alice initiates
-- ------------------------------------------------------------------------

create or replace function public.request_partner_link(p_target_friend_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target_code text := upper(trim(coalesce(p_target_friend_code, '')));
  v_target_id uuid;
  v_existing record;
  v_link_id uuid;
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;
  if v_target_code !~ '^HH-[A-Z]{4,6}-[0-9]{2,4}$' then
    raise exception 'invalid friend code';
  end if;

  select id into v_target_id
    from public.profiles
   where upper(friend_code) = v_target_code;
  if v_target_id is null then
    raise exception 'no profile with that friend code';
  end if;
  if v_target_id = v_uid then
    raise exception 'cannot partner with yourself';
  end if;

  -- Check for any existing link between this pair. The unique partial
  -- index on (least(...), greatest(...)) WHERE status in
  -- ('pending','accepted') already enforces uniqueness, but we want a
  -- clean "you already have an active link" error rather than a 23505.
  select id, status, requester_id, partner_id
    into v_existing
  from public.partner_links
   where least(requester_id, partner_id) = least(v_uid, v_target_id)
     and greatest(requester_id, partner_id) = greatest(v_uid, v_target_id)
     and status in ('pending', 'accepted')
   limit 1;

  if v_existing.id is not null then
    if v_existing.status = 'accepted' then
      raise exception 'you are already partnered';
    else
      raise exception 'a partner request already exists for this pair';
    end if;
  end if;

  insert into public.partner_links (requester_id, partner_id, status)
  values (v_uid, v_target_id, 'pending')
  returning id into v_link_id;
  return v_link_id;
end;
$$;

revoke all on function public.request_partner_link(text) from public;
grant execute on function public.request_partner_link(text) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 2. respond_partner_link — Bob accepts or declines
-- ------------------------------------------------------------------------

create or replace function public.respond_partner_link(
  p_link_id uuid,
  p_accept boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_link record;
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;

  select * into v_link
  from public.partner_links
   where id = p_link_id;
  if v_link.id is null then
    raise exception 'partner request not found';
  end if;

  -- Only the partner (the recipient) can respond; the requester can
  -- cancel via unlink_partner.
  if v_link.partner_id <> v_uid then
    raise exception 'only the recipient can respond to a partner request';
  end if;
  if v_link.status <> 'pending' then
    raise exception 'request is no longer pending';
  end if;

  if p_accept then
    update public.partner_links
       set status = 'accepted',
           anniversary_on = current_date,
           updated_at = now()
     where id = p_link_id;
    return true;
  else
    update public.partner_links
       set status = 'declined', updated_at = now()
     where id = p_link_id;
    return false;
  end if;
end;
$$;

revoke all on function public.respond_partner_link(uuid, boolean) from public;
grant execute on function public.respond_partner_link(uuid, boolean) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 3. unlink_partner — either side ends the relationship
-- ------------------------------------------------------------------------
-- Marks the active link as 'declined' rather than deleting. Preserves
-- the historical record (anniversary, when they were paired) and lets
-- a future audit walk the row. Re-pairing is allowed because the
-- unique partial index only constrains ('pending','accepted') rows.

create or replace function public.unlink_partner()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_link_id uuid;
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;

  select id into v_link_id
    from public.partner_links
   where status = 'accepted'
     and v_uid in (requester_id, partner_id)
   limit 1;
  if v_link_id is null then
    return false;
  end if;

  update public.partner_links
     set status = 'declined', updated_at = now()
   where id = v_link_id;
  return true;
end;
$$;

revoke all on function public.unlink_partner() from public;
grant execute on function public.unlink_partner() to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 4. get_my_partner — read current state (used by the client hook)
-- ------------------------------------------------------------------------
-- Returns the most-recent active or pending link. Includes the partner's
-- friend code + display name so the client can show their name without
-- a second round-trip.

create or replace function public.get_my_partner()
returns table (
  link_id uuid,
  status text,
  role text,                          -- 'requester' or 'partner' (us)
  other_profile_id uuid,
  other_friend_code text,
  other_display_name text,
  anniversary_on date,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  return query
  select
    pl.id,
    pl.status::text,
    case when pl.requester_id = v_uid then 'requester' else 'partner' end,
    case when pl.requester_id = v_uid then pl.partner_id else pl.requester_id end,
    p.friend_code,
    p.display_name,
    pl.anniversary_on,
    pl.created_at,
    pl.updated_at
  from public.partner_links pl
  join public.profiles p on p.id = case when pl.requester_id = v_uid then pl.partner_id else pl.requester_id end
  where v_uid in (pl.requester_id, pl.partner_id)
    and pl.status in ('pending', 'accepted')
  order by pl.created_at desc
  limit 1;
end;
$$;

revoke all on function public.get_my_partner() from public;
grant execute on function public.get_my_partner() to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 5. Realtime publication so the recipient sees a fresh request live
-- ------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.partner_links;
    exception when others then
      null; -- already in publication
    end;
  end if;
end $$;
