-- 0097_ephemeral_chat.sql
--
-- Stop storing chat. Keep the mute and the flood guard.
--
-- Chat is delivered live over a Realtime broadcast channel; the table was
-- only ever a backfill for someone arriving, and 0096 stopped reading it.
-- Keeping it wrote every message anyone ever sent into the database for no
-- one to read: a spammer filling a room filled the database with it, and a
-- table of everybody's conversations is the worst thing to still be holding
-- if anything ever leaks.
--
-- So messages are no longer written at all. Nothing is at rest, which is a
-- stronger privacy position than any retention rule, and the table cannot be
-- clogged by chatter because chatter never reaches it.
--
-- WHAT THIS COSTS, AND WHAT REPLACES IT. 0096 put the mute and the flood
-- guard inside send_place_chat_message, which only worked because every
-- message passed through the server on its way to being stored. Remove the
-- storage and that enforcement point goes with it — a muted keeper would
-- simply broadcast, because a broadcast leaves the sender's own machine.
--
-- authorize_place_chat replaces it: the client must be told it may speak
-- before it broadcasts, and that answer is the server's. It stores no
-- message. What it does keep is a counter — one row per keeper, holding a
-- window start and a count, and never a word of what was said. That is the
-- smallest state that can stop a flood, and it is bounded by how many
-- keepers exist rather than by how much they type.
--
-- Sending is still, ultimately, the client broadcasting. A modified client
-- can skip the authorization call, which is why the mute ALSO belongs on the
-- Realtime channel itself; that is a Supabase channel-authorization change
-- rather than a schema one, and is noted in the verification script.

create table if not exists public.chat_rate_counters (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  sent_in_window integer not null default 0 check (sent_in_window >= 0)
);

comment on table public.chat_rate_counters is
  'Flood-guard bookkeeping for chat. One row per keeper, holding only a window start and a count — never any message content. Chat itself is never stored: it is delivered over Realtime broadcast and kept nowhere.';

alter table public.chat_rate_counters enable row level security;

-- Only the function touches this; nobody reads or writes it directly.
drop policy if exists "chat counters are function-managed" on public.chat_rate_counters;
create policy "chat counters are function-managed"
  on public.chat_rate_counters for all to authenticated
  using (false) with check (false);

create or replace function public.authorize_place_chat(
  p_place_type text,
  p_host_friend_code text,
  p_place_id text
)
returns table (sender_friend_code text, sender_display_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_window constant interval := interval '10 seconds';
  c_limit  constant integer  := 10;

  v_sender uuid := auth.uid();
  v_host_code text := upper(trim(coalesce(p_host_friend_code, '')));
  v_host_profile_id uuid;
  v_window_started timestamptz;
  v_sent integer;
begin
  if v_sender is null then
    raise exception 'sign in required';
  end if;
  if p_place_type not in ('room', 'garden', 'park', 'partner-garden') then
    raise exception 'invalid chat place';
  end if;
  if v_host_code !~ '^HH-[A-Z]{5}-[0-9]{3}$' then
    raise exception 'invalid host code';
  end if;
  if trim(coalesce(p_place_id, '')) = '' then
    raise exception 'missing place id';
  end if;

  select host_profile.id into v_host_profile_id
    from public.profiles as host_profile
   where upper(host_profile.friend_code) = v_host_code
   limit 1;
  if v_host_profile_id is null then
    raise exception 'host not found';
  end if;
  if not public.can_chat_in_host_place(v_host_profile_id, v_sender) then
    raise exception 'only friends can chat in this place';
  end if;

  -- The mute, enforced where it can be checked rather than where the sender
  -- happens to agree to check it.
  if exists (
    select 1 from public.profiles as muted
     where muted.id = v_sender
       and muted.chat_quarantined_until is not null
       and muted.chat_quarantined_until > now()
  ) then
    raise exception 'chat is paused while recent activity is reviewed'
      using errcode = '53400', hint = 'chat_quarantined';
  end if;

  -- Flood guard, on a fixed window. Counts only; no content.
  insert into public.chat_rate_counters (profile_id, window_started_at, sent_in_window)
  values (v_sender, now(), 0)
  on conflict (profile_id) do nothing;

  select counter.window_started_at, counter.sent_in_window
    into v_window_started, v_sent
    from public.chat_rate_counters as counter
   where counter.profile_id = v_sender
   for update;

  if v_window_started is null or now() - v_window_started > c_window then
    v_window_started := now();
    v_sent := 0;
  end if;

  if v_sent >= c_limit then
    raise exception 'sending too quickly, take a breath'
      using errcode = '53400', hint = 'chat_rate_limit';
  end if;

  update public.chat_rate_counters
     set window_started_at = v_window_started,
         sent_in_window = v_sent + 1
   where profile_id = v_sender;

  -- The caller's own identity, so a name shown beside a message comes from
  -- the profile rather than from whatever the sending client typed.
  return query
    select
      sender_profile.friend_code,
      coalesce(
        nullif(trim(sender_profile.username), ''),
        nullif(trim(sender_profile.display_name), ''),
        'Keeper'
      )
      from public.profiles as sender_profile
     where sender_profile.id = v_sender;
end;
$$;

comment on function public.authorize_place_chat(text, text, text) is
  'Decides whether this keeper may speak in this place right now, and returns the identity to show beside their message. Enforces the mute and the flood guard. Stores no message: chat is delivered over Realtime broadcast and kept nowhere.';

revoke all on function public.authorize_place_chat(text, text, text) from public;
grant execute on function public.authorize_place_chat(text, text, text) to authenticated, service_role;

-- The stored chat, and everything that read or wrote it, goes away. Dropping
-- the table deletes the conversations it still holds, which is the point.
drop function if exists public.send_place_chat_message(text, text, text, text);
drop function if exists public.get_place_chat_messages(text, text, text, integer);
drop function if exists public.clear_place_chat(text, text, text);
drop table if exists public.place_chat_messages;
