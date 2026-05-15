-- Friend-gated discovery, safety records, blocks, played-with history, and
-- transaction-safe inventory gifts.

alter table public.profiles
  add column if not exists moderation_status text not null default 'active'
    check (moderation_status in ('active', 'review', 'quarantined', 'banned')),
  add column if not exists chat_quarantined_until timestamptz,
  add column if not exists chat_severe_flag_count integer not null default 0 check (chat_severe_flag_count >= 0);

create table public.friend_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.played_with_log (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  other_id uuid not null references public.profiles(id) on delete cascade,
  context text not null default 'world',
  last_played_at timestamptz not null default now(),
  metadata jsonb not null default '{}',
  primary key (owner_id, other_id),
  check (owner_id <> other_id)
);

create table public.safety_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  offender_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('harassment', 'explicit-content', 'grooming-suspected', 'spam-or-scam', 'hate-speech', 'other')),
  details text,
  chat_excerpt text,
  scene text,
  auto_flagged boolean not null default false,
  status text not null default 'new' check (status in ('new', 'reviewing', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_notes text,
  check (reporter_id <> offender_id)
);

create table public.inventory_gifts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  catalog_item_id text not null references public.catalog_items(id),
  quantity integer not null default 1 check (quantity > 0),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'declined', 'cancelled')),
  message text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  check (sender_id <> recipient_id)
);

create index friend_blocks_blocked_idx on public.friend_blocks (blocked_id);
create index played_with_log_other_idx on public.played_with_log (other_id, last_played_at desc);
create index safety_reports_offender_idx on public.safety_reports (offender_id, created_at desc);
create index inventory_gifts_recipient_idx on public.inventory_gifts (recipient_id, status, created_at desc);

create or replace function public.generate_friend_code()
returns text
language sql
as $$
  with letters as (
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1), '') as code
    from generate_series(1, 5)
  )
  select 'HH-' || letters.code || '-' || lpad((floor(random() * 900) + 100)::int::text, 3, '0')
  from letters
$$;

create or replace function public.are_friends(left_profile uuid, right_profile uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = left_profile and f.friend_id = right_profile)
        or (f.requester_id = right_profile and f.friend_id = left_profile)
      )
  );
$$;

create or replace function public.can_profiles_interact(target_profile_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select auth.uid() = target_profile_id
    or public.are_friends(auth.uid(), target_profile_id)
    or exists (
      select 1
      from public.played_with_log pw
      where pw.owner_id = auth.uid()
        and pw.other_id = target_profile_id
    )
    or exists (
      select 1
      from public.partner_links pl
      where pl.status = 'accepted'
        and auth.uid() in (pl.requester_id, pl.partner_id)
        and target_profile_id in (pl.requester_id, pl.partner_id)
    );
$$;

create or replace function public.friend_code_lookup(target_code text)
returns table(id uuid, display_name text, friend_code text, avatar_key text)
language sql
security definer
set search_path = public
as $$
  -- Public lookup surfaces only the keeper username (or friend code fallback).
  -- Private/legal name context stays in backend-only profile columns.
  select p.id, coalesce(nullif(p.username, ''), p.friend_code) as display_name, p.friend_code, p.avatar_key
  from public.profiles p
  where p.friend_code = upper(trim(target_code))
    and public.can_profiles_interact(p.id)
    and p.moderation_status <> 'banned'
  limit 1;
$$;

create or replace function public.record_played_with(other_profile_id uuid, session_context text default 'world')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() = other_profile_id then
    return;
  end if;

  insert into public.played_with_log (owner_id, other_id, context, last_played_at)
  values (auth.uid(), other_profile_id, coalesce(session_context, 'world'), now())
  on conflict (owner_id, other_id)
  do update set context = excluded.context, last_played_at = now();
end;
$$;

create or replace function public.send_inventory_gift(
  recipient_profile_id uuid,
  target_catalog_item_id text,
  gift_quantity integer default 1,
  gift_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_gift_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if gift_quantity < 1 then
    raise exception 'gift quantity must be positive';
  end if;
  if not public.are_friends(auth.uid(), recipient_profile_id) then
    raise exception 'gifts can only be sent to accepted friends';
  end if;
  if exists (
    select 1 from public.friend_blocks
    where (blocker_id = auth.uid() and blocked_id = recipient_profile_id)
       or (blocker_id = recipient_profile_id and blocked_id = auth.uid())
  ) then
    raise exception 'gifts cannot be sent while a block is active';
  end if;

  update public.inventory_items
  set quantity = quantity - gift_quantity,
      updated_at = now()
  where owner_id = auth.uid()
    and catalog_item_id = target_catalog_item_id
    and quantity >= gift_quantity;

  if not found then
    raise exception 'sender does not own enough inventory';
  end if;

  delete from public.inventory_items
  where owner_id = auth.uid()
    and catalog_item_id = target_catalog_item_id
    and quantity = 0;

  insert into public.inventory_gifts (sender_id, recipient_id, catalog_item_id, quantity, message)
  values (auth.uid(), recipient_profile_id, target_catalog_item_id, gift_quantity, gift_message)
  returning id into new_gift_id;

  return new_gift_id;
end;
$$;

create or replace function public.claim_inventory_gift(target_gift_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  gift_row public.inventory_gifts%rowtype;
begin
  select * into gift_row
  from public.inventory_gifts
  where id = target_gift_id
    and recipient_id = auth.uid()
    and status = 'pending'
  for update;

  if not found then
    raise exception 'gift not found';
  end if;

  insert into public.inventory_items (owner_id, catalog_item_id, quantity)
  values (auth.uid(), gift_row.catalog_item_id, gift_row.quantity)
  on conflict (owner_id, catalog_item_id)
  do update set quantity = public.inventory_items.quantity + excluded.quantity,
                updated_at = now();

  update public.inventory_gifts
  set status = 'claimed',
      claimed_at = now()
  where id = target_gift_id;
end;
$$;

grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.can_profiles_interact(uuid) to authenticated;
grant execute on function public.friend_code_lookup(text) to authenticated;
grant execute on function public.record_played_with(uuid, text) to authenticated;
grant execute on function public.send_inventory_gift(uuid, text, integer, text) to authenticated;
grant execute on function public.claim_inventory_gift(uuid) to authenticated;

alter table public.friend_blocks enable row level security;
alter table public.played_with_log enable row level security;
alter table public.safety_reports enable row level security;
alter table public.inventory_gifts enable row level security;

drop policy if exists "Profiles are visible to authenticated players" on public.profiles;

create policy "Profiles visible to self friends played-with and partners"
on public.profiles for select to authenticated
using (public.can_profiles_interact(id));

create policy "Players manage their own blocks"
on public.friend_blocks for all to authenticated
using (auth.uid() = blocker_id)
with check (auth.uid() = blocker_id);

create policy "Players read their own played-with graph"
on public.played_with_log for select to authenticated
using (auth.uid() = owner_id);

create policy "Players record their own played-with graph"
on public.played_with_log for insert to authenticated
with check (auth.uid() = owner_id);

create policy "Players update their own played-with graph"
on public.played_with_log for update to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "Players create safety reports"
on public.safety_reports for insert to authenticated
with check (auth.uid() = reporter_id);

create policy "Players read reports they filed"
on public.safety_reports for select to authenticated
using (auth.uid() = reporter_id);

create policy "Gift participants can read gifts"
on public.inventory_gifts for select to authenticated
using (auth.uid() in (sender_id, recipient_id));

comment on table public.safety_reports is
  'Moderation reports with public user identifiers and scene context. IP/email/user-agent stay in Supabase Auth logs and are joined by service-role admin tooling only for legitimate legal process.';

comment on function public.send_inventory_gift(uuid, text, integer, text) is
  'Trusted RPC: sends an item to an accepted friend and atomically subtracts it from the sender inventory.';
