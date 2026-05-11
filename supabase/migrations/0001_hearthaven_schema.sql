-- HeartHaven baseline schema
-- Phase coverage:
-- 1. starter catalog and app shell data
-- 2. persistent profiles, pets, worlds, rooms, gardens, inventory, wallets, placed items
-- 5. friend codes, partner linking, love notes, memory book
-- 6. room sessions for Realtime presence
-- 7. private Nicholas + Gianna gift content

create extension if not exists pgcrypto;

create type public.item_category as enum (
  'flooring',
  'wall',
  'decor',
  'furniture',
  'garden',
  'keepsake'
);

create type public.placement_type as enum (
  'floor',
  'wall',
  'garden_plot',
  'inventory_only'
);

create type public.item_rarity as enum (
  'starter',
  'common',
  'rare',
  'private'
);

create type public.partner_link_status as enum (
  'pending',
  'accepted',
  'declined',
  'blocked'
);

create type public.friendship_status as enum (
  'pending',
  'accepted',
  'blocked'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.generate_friend_code()
returns text
language sql
as $$
  select upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 10));
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null,
  avatar_key text default 'keeper-blush',
  friend_code text not null unique default public.generate_friend_code(),
  bio text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wallets (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  coins integer not null default 500 check (coins >= 0),
  hearts integer not null default 5 check (hearts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  species text not null,
  name text not null,
  tone text not null default 'cream',
  happiness integer not null default 80 check (happiness between 0 and 100),
  hunger integer not null default 20 check (hunger between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.worlds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  slug text not null,
  visibility text not null default 'friends' check (visibility in ('private', 'friends', 'partner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  world_id uuid not null references public.worlds(id) on delete cascade,
  room_type text not null default 'personal',
  name text not null,
  width integer not null default 800,
  height integer not null default 500,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.partner_links (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  partner_id uuid not null references public.profiles(id) on delete cascade,
  status public.partner_link_status not null default 'pending',
  anniversary_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> partner_id)
);

create unique index partner_links_pair_unique
on public.partner_links (least(requester_id, partner_id), greatest(requester_id, partner_id))
where status in ('pending', 'accepted');

create table public.gardens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  partner_link_id uuid references public.partner_links(id) on delete set null,
  name text not null,
  garden_type text not null default 'personal' check (garden_type in ('personal', 'partner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.catalog_items (
  id text primary key,
  category public.item_category not null,
  name text not null,
  description text not null,
  price_coins integer not null default 0 check (price_coins >= 0),
  price_hearts integer not null default 0 check (price_hearts >= 0),
  rarity public.item_rarity not null default 'common',
  asset_key text not null,
  placement_type public.placement_type not null,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  catalog_item_id text not null references public.catalog_items(id),
  quantity integer not null default 1 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, catalog_item_id)
);

create table public.placed_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  garden_id uuid references public.gardens(id) on delete cascade,
  catalog_item_id text not null references public.catalog_items(id),
  x numeric(10, 2) not null,
  y numeric(10, 2) not null,
  rotation numeric(8, 3) not null default 0,
  scale numeric(8, 3) not null default 1,
  z_index integer not null default 0,
  state jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((room_id is not null and garden_id is null) or (room_id is null and garden_id is not null))
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> friend_id)
);

create unique index friendships_pair_unique
on public.friendships (least(requester_id, friend_id), greatest(requester_id, friend_id));

create table public.love_notes (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  partner_link_id uuid references public.partner_links(id) on delete set null,
  subject text not null,
  body text not null,
  scheduled_for timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  is_private boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

create table public.memory_book_pages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  partner_link_id uuid references public.partner_links(id) on delete set null,
  title text not null,
  body text not null default '',
  page_type text not null default 'journal',
  media jsonb not null default '[]',
  is_private boolean not null default true,
  happened_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  achievement_key text not null,
  title text not null,
  description text not null default '',
  unlocked_at timestamptz,
  metadata jsonb not null default '{}',
  unique (owner_id, achievement_key)
);

create table public.quests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  partner_link_id uuid references public.partner_links(id) on delete set null,
  quest_key text not null,
  title text not null,
  status text not null default 'locked' check (status in ('locked', 'active', 'complete')),
  steps jsonb not null default '[]',
  rewards jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, quest_key)
);

create table public.room_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  invite_code text not null unique default public.generate_friend_code(),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.room_session_members (
  session_id uuid not null references public.room_sessions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  presence_state jsonb not null default '{}',
  primary key (session_id, profile_id)
);

create or replace function public.is_partner_member(link_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.partner_links pl
    where pl.id = link_id
      and pl.status = 'accepted'
      and auth.uid() in (pl.requester_id, pl.partner_id)
  );
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger wallets_set_updated_at before update on public.wallets for each row execute function public.set_updated_at();
create trigger pets_set_updated_at before update on public.pets for each row execute function public.set_updated_at();
create trigger worlds_set_updated_at before update on public.worlds for each row execute function public.set_updated_at();
create trigger rooms_set_updated_at before update on public.rooms for each row execute function public.set_updated_at();
create trigger partner_links_set_updated_at before update on public.partner_links for each row execute function public.set_updated_at();
create trigger gardens_set_updated_at before update on public.gardens for each row execute function public.set_updated_at();
create trigger catalog_items_set_updated_at before update on public.catalog_items for each row execute function public.set_updated_at();
create trigger inventory_items_set_updated_at before update on public.inventory_items for each row execute function public.set_updated_at();
create trigger placed_items_set_updated_at before update on public.placed_items for each row execute function public.set_updated_at();
create trigger friendships_set_updated_at before update on public.friendships for each row execute function public.set_updated_at();
create trigger love_notes_set_updated_at before update on public.love_notes for each row execute function public.set_updated_at();
create trigger memory_book_pages_set_updated_at before update on public.memory_book_pages for each row execute function public.set_updated_at();
create trigger quests_set_updated_at before update on public.quests for each row execute function public.set_updated_at();
create trigger room_sessions_set_updated_at before update on public.room_sessions for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.pets enable row level security;
alter table public.worlds enable row level security;
alter table public.rooms enable row level security;
alter table public.partner_links enable row level security;
alter table public.gardens enable row level security;
alter table public.catalog_items enable row level security;
alter table public.inventory_items enable row level security;
alter table public.placed_items enable row level security;
alter table public.friendships enable row level security;
alter table public.love_notes enable row level security;
alter table public.memory_book_pages enable row level security;
alter table public.achievements enable row level security;
alter table public.quests enable row level security;
alter table public.room_sessions enable row level security;
alter table public.room_session_members enable row level security;

create policy "Profiles are visible to authenticated players"
on public.profiles for select to authenticated using (true);

create policy "Players insert their own profile"
on public.profiles for insert to authenticated with check (auth.uid() = id);

create policy "Players update their own profile"
on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "Players manage their own wallet"
on public.wallets for all to authenticated using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

create policy "Players manage their own pets"
on public.pets for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Players manage their own worlds"
on public.worlds for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Players manage their own rooms"
on public.rooms for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Partner links are visible to members"
on public.partner_links for select to authenticated using (auth.uid() in (requester_id, partner_id));

create policy "Players request partner links"
on public.partner_links for insert to authenticated with check (auth.uid() = requester_id);

create policy "Members update partner links"
on public.partner_links for update to authenticated using (auth.uid() in (requester_id, partner_id)) with check (auth.uid() in (requester_id, partner_id));

create policy "Players manage personal gardens and accepted partner gardens"
on public.gardens for all to authenticated
using (auth.uid() = owner_id or public.is_partner_member(partner_link_id))
with check (auth.uid() = owner_id or public.is_partner_member(partner_link_id));

create policy "Catalog is readable by players"
on public.catalog_items for select to authenticated using (active = true);

create policy "Players manage their own inventory"
on public.inventory_items for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Players manage their own placed items"
on public.placed_items for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Friendships are visible to members"
on public.friendships for select to authenticated using (auth.uid() in (requester_id, friend_id));

create policy "Players request friendships"
on public.friendships for insert to authenticated with check (auth.uid() = requester_id);

create policy "Friendship members update state"
on public.friendships for update to authenticated using (auth.uid() in (requester_id, friend_id)) with check (auth.uid() in (requester_id, friend_id));

create policy "Love notes are visible to sender and recipient"
on public.love_notes for select to authenticated using (auth.uid() in (sender_id, recipient_id));

create policy "Players send love notes"
on public.love_notes for insert to authenticated with check (auth.uid() = sender_id);

create policy "Recipients can mark love notes read"
on public.love_notes for update to authenticated using (auth.uid() in (sender_id, recipient_id)) with check (auth.uid() in (sender_id, recipient_id));

create policy "Memory pages visible to owner or partner"
on public.memory_book_pages for select to authenticated
using (auth.uid() = owner_id or public.is_partner_member(partner_link_id));

create policy "Players manage their memory pages"
on public.memory_book_pages for insert to authenticated with check (auth.uid() = owner_id);

create policy "Players update accessible memory pages"
on public.memory_book_pages for update to authenticated
using (auth.uid() = owner_id or public.is_partner_member(partner_link_id))
with check (auth.uid() = owner_id or public.is_partner_member(partner_link_id));

create policy "Players manage their achievements"
on public.achievements for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Players manage their quests"
on public.quests for all to authenticated using (auth.uid() = owner_id or public.is_partner_member(partner_link_id)) with check (auth.uid() = owner_id or public.is_partner_member(partner_link_id));

create policy "Room sessions are readable by players"
on public.room_sessions for select to authenticated using (true);

create policy "Hosts manage room sessions"
on public.room_sessions for all to authenticated using (auth.uid() = host_id) with check (auth.uid() = host_id);

create policy "Players manage their own session membership"
on public.room_session_members for all to authenticated using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

insert into public.catalog_items
  (id, category, name, description, price_coins, price_hearts, rarity, asset_key, placement_type, tags)
values
  ('cozy-rug-blush', 'flooring', 'Blush Hearth Rug', 'A soft oval rug that makes any room feel warmer.', 120, 0, 'starter', 'rug-blush', 'floor', array['room', 'cozy', 'starter']),
  ('window-garden-arch', 'wall', 'Garden Arch Window', 'A window with climbing leaves and a clear view of the meadow.', 180, 0, 'starter', 'window-arch', 'wall', array['room', 'wall', 'garden']),
  ('lamp-honey-lantern', 'decor', 'Honey Lantern', 'Warm light for late-night letters and quiet visits.', 95, 1, 'starter', 'lantern-honey', 'floor', array['room', 'garden', 'light']),
  ('chair-lavender-cushion', 'furniture', 'Lavender Reading Chair', 'A small chair for your companion to nap beside.', 210, 0, 'common', 'chair-lavender', 'floor', array['room', 'seat']),
  ('planter-moonberry', 'garden', 'Moonberry Planter', 'A starter planter that grows moonberries over time.', 150, 1, 'starter', 'planter-moonberry', 'garden_plot', array['garden', 'crop']),
  ('note-paper-cream', 'keepsake', 'Cream Letter Set', 'Stationery for private notes and memory book pages.', 60, 0, 'starter', 'letter-cream', 'inventory_only', array['notes', 'memory']),
  ('ng-garden-gate', 'garden', 'Nicholas & Gianna Garden Gate', 'Private entrance to the partner gift garden.', 0, 0, 'private', 'ng-garden-gate', 'garden_plot', array['private', 'partner']),
  ('casper-guardian-statue', 'decor', 'Casper Guardian Statue', 'A private keepsake for the Guardian of Our Garden milestone.', 0, 0, 'private', 'casper-guardian-statue', 'floor', array['private', 'casper'])
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  price_coins = excluded.price_coins,
  price_hearts = excluded.price_hearts,
  rarity = excluded.rarity,
  asset_key = excluded.asset_key,
  placement_type = excluded.placement_type,
  tags = excluded.tags,
  active = true,
  updated_at = now();
