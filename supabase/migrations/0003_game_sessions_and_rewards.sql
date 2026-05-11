-- Durable multiplayer game sessions and protected reward events.
-- The app currently awards locally for responsiveness; these tables are the production path.

create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  game_key text not null,
  mode text not null default 'solo',
  status text not null default 'waiting' check (status in ('waiting', 'active', 'complete', 'cancelled')),
  invite_code text not null unique default public.generate_friend_code(),
  max_players integer not null default 2 check (max_players between 1 and 12),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.game_session_players (
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null default 'Keeper',
  seat_index integer not null default 0 check (seat_index >= 0),
  team_key text not null default 'solo',
  ready boolean not null default false,
  score integer not null default 0 check (score >= 0),
  metadata jsonb not null default '{}',
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, profile_id),
  unique (session_id, seat_index)
);

create table public.game_reward_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  game_session_id uuid references public.game_sessions(id) on delete set null,
  game_key text not null,
  score integer not null default 0 check (score >= 0),
  coins integer not null default 0 check (coins >= 0),
  hearts integer not null default 0 check (hearts >= 0),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index game_sessions_host_idx on public.game_sessions (host_id, created_at desc);
create index game_sessions_invite_code_idx on public.game_sessions (invite_code);
create index game_session_players_profile_idx on public.game_session_players (profile_id);
create index game_reward_events_profile_idx on public.game_reward_events (profile_id, created_at desc);

create trigger game_sessions_set_updated_at
before update on public.game_sessions
for each row execute function public.set_updated_at();

create trigger game_session_players_set_updated_at
before update on public.game_session_players
for each row execute function public.set_updated_at();

create or replace function public.is_game_session_member(target_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.game_sessions gs
    where gs.id = target_session_id
      and gs.host_id = auth.uid()
  )
  or exists (
    select 1
    from public.game_session_players gsp
    where gsp.session_id = target_session_id
      and gsp.profile_id = auth.uid()
  );
$$;

grant execute on function public.is_game_session_member(uuid) to authenticated;

alter table public.game_sessions enable row level security;
alter table public.game_session_players enable row level security;
alter table public.game_reward_events enable row level security;

create policy "Players read game sessions they belong to"
on public.game_sessions for select to authenticated
using (public.is_game_session_member(id));

create policy "Players host game sessions"
on public.game_sessions for insert to authenticated
with check (auth.uid() = host_id);

create policy "Hosts update game sessions"
on public.game_sessions for update to authenticated
using (auth.uid() = host_id)
with check (auth.uid() = host_id);

create policy "Players read session seats they belong to"
on public.game_session_players for select to authenticated
using (public.is_game_session_member(session_id));

create policy "Players join sessions as themselves"
on public.game_session_players for insert to authenticated
with check (profile_id = auth.uid());

create policy "Players update their own game seat"
on public.game_session_players for update to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

create policy "Players read their own reward events"
on public.game_reward_events for select to authenticated
using (profile_id = auth.uid());

comment on table public.game_reward_events is
  'Append-only reward ledger for validated mini-game results. Inserts should be performed by trusted server/service-role code after anti-cheat checks.';
