-- 0096_chat_mute_rate_limit_and_clear.sql
--
-- Three things about chat: make a mute mean something, stop a flood, and
-- clear a place's history whenever somebody joins it.
--
-- THE MUTE. profiles.chat_quarantined_until has existed since 0010 and is
-- protected from self-edit by 0019, which calls it "the timestamp until
-- which the user is muted". Nothing ever read it. send_place_chat_message
-- checked that the sender was signed in, that the place was real and that
-- the body fitted — and then wrote the message. The only thing standing
-- between a muted keeper and the room was isLocallyQuarantined() in their
-- own browser, reading their own local storage. A moderator muting someone
-- achieved nothing; clearing site data lifted an auto-quarantine.
--
-- THE FLOOD. Chat rate limiting was also client-side only, five messages per
-- ten seconds held in localStorage. The server limit here is deliberately
-- looser so ordinary chatter never trips it.
--
-- CLEARING ON JOIN. Messages were kept indefinitely and get_place_chat_
-- messages handed a joiner the last thirty, including everything said before
-- they arrived. Chat is delivered live over a broadcast channel and the table
-- is only consulted for that backfill, so clearing it takes nothing away from
-- anyone already in the room — their conversation is already on their screen
-- — while making sure nobody can read back a conversation they were not part
-- of, and the table cannot grow forever.
--
-- Moderation evidence is unaffected: a report copies the offending text into
-- its own chat_excerpt column, so reports keep their copy after the chat is
-- cleared.

create or replace function public.clear_place_chat(
  p_host_friend_code text,
  p_place_type text,
  p_place_id text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_host_profile_id uuid;
  v_host_code text := upper(trim(coalesce(p_host_friend_code, '')));
  v_place_id text := trim(coalesce(p_place_id, ''));
  v_deleted integer;
begin
  if v_caller is null then
    raise exception 'sign in required';
  end if;
  if p_place_type not in ('room', 'garden', 'park', 'partner-garden') then
    raise exception 'invalid chat place';
  end if;

  select id into v_host_profile_id from public.profiles
   where upper(friend_code) = v_host_code limit 1;
  if v_host_profile_id is null then
    raise exception 'host not found';
  end if;

  -- Only somebody entitled to chat here may clear it. Anyone who can read
  -- the history can already clear it by joining, so this grants nothing new.
  if not public.can_chat_in_host_place(v_host_profile_id, v_caller) then
    raise exception 'only friends can chat in this place';
  end if;

  delete from public.place_chat_messages
   where host_profile_id = v_host_profile_id
     and place_type = p_place_type
     and place_id = v_place_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.clear_place_chat(text, text, text) is
  'Clears a place''s stored chat. Called when a keeper joins, so nobody reads back a conversation they were not part of and the table cannot grow without bound. Chat is delivered live over broadcast, so this removes only the backfill, not anything already on screen. Reported messages keep their own copy in the report.';

revoke all on function public.clear_place_chat(text, text, text) from public;
grant execute on function public.clear_place_chat(text, text, text) to authenticated, service_role;

create or replace function public.send_place_chat_message(
  p_place_type text,
  p_host_friend_code text,
  p_place_id text,
  p_body text
)
returns table (
  id uuid,
  place_type text,
  place_id text,
  host_friend_code text,
  sender_friend_code text,
  sender_display_name text,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_id uuid := auth.uid();
  v_place_type text := lower(trim(coalesce(p_place_type, '')));
  v_host_friend_code text := upper(trim(coalesce(p_host_friend_code, '')));
  v_place_id text := regexp_replace(trim(coalesce(p_place_id, '')), '[^a-zA-Z0-9_-]', '', 'g');
  v_body text := trim(coalesce(p_body, ''));
  v_host_profile_id uuid;
  v_sender_friend_code text;
  v_sender_display_name text;
begin
  if v_sender_id is null then
    raise exception 'sign in required';
  end if;
  if v_place_type not in ('room', 'garden', 'park', 'partner-garden') then
    raise exception 'invalid chat place';
  end if;
  if v_host_friend_code !~ '^HH-[A-Z]{5}-[0-9]{3}$' then
    raise exception 'invalid host code';
  end if;
  if v_place_id = '' then
    raise exception 'missing place id';
  end if;
  if char_length(v_body) = 0 or char_length(v_body) > 240 then
    raise exception 'message must be 1-240 characters';
  end if;

  select host_profile.id
    into v_host_profile_id
  from public.profiles as host_profile
  where upper(host_profile.friend_code) = v_host_friend_code
  limit 1;

  if v_host_profile_id is null then
    raise exception 'host not found';
  end if;
  if not public.can_chat_in_host_place(v_host_profile_id, v_sender_id) then
    raise exception 'only friends can chat in this place';
  end if;

  /* A mute has to be enforced where the message is written. This column has
     existed since 0010, is protected from self-edit by 0019, and is
     documented as "the timestamp until which the user is muted" — but
     nothing read it here, so muting somebody did nothing at all. The check
     in the browser is the sender's own client agreeing to stay quiet. */
  -- Aliased throughout: this function's `returns table` declares columns
  -- named id and created_at, so a bare reference here is ambiguous and the
  -- whole send fails rather than the check simply not working.
  if exists (
    select 1 from public.profiles as muted
     where muted.id = v_sender_id
       and muted.chat_quarantined_until is not null
       and muted.chat_quarantined_until > now()
  ) then
    raise exception 'chat is paused while recent activity is reviewed'
      using errcode = '53400', hint = 'chat_quarantined';
  end if;

  /* Flood guard. The browser allows five messages per ten seconds; this sits
     deliberately above that so ordinary chatter never trips it, and stops a
     client that has simply removed the check. */
  if (
    select count(*) from public.place_chat_messages as recent
     where recent.sender_id = v_sender_id
       and recent.created_at >= now() - interval '10 seconds'
  ) >= 10 then
    raise exception 'sending too quickly, take a breath'
      using errcode = '53400', hint = 'chat_rate_limit';
  end if;

  select
    sender_profile.friend_code,
    coalesce(nullif(trim(sender_profile.username), ''), nullif(trim(sender_profile.display_name), ''), 'Keeper')
    into v_sender_friend_code, v_sender_display_name
  from public.profiles as sender_profile
  where sender_profile.id = v_sender_id;

  if v_sender_friend_code is null then
    raise exception 'sender profile is missing';
  end if;

  return query
  insert into public.place_chat_messages (
    place_type,
    host_profile_id,
    host_friend_code,
    place_id,
    sender_id,
    sender_friend_code,
    sender_display_name,
    body
  )
  values (
    v_place_type,
    v_host_profile_id,
    v_host_friend_code,
    v_place_id,
    v_sender_id,
    upper(v_sender_friend_code),
    v_sender_display_name,
    v_body
  )
  returning
    place_chat_messages.id,
    place_chat_messages.place_type,
    place_chat_messages.place_id,
    place_chat_messages.host_friend_code,
    place_chat_messages.sender_friend_code,
    place_chat_messages.sender_display_name,
    place_chat_messages.body,
    place_chat_messages.created_at;
end;
$$;
