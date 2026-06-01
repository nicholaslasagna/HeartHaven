-- 0051_place_invite_target_canonicalization.sql
--
-- Direct place invites must navigate guests into the host's world. The
-- browser can hold a stale local friend code, so do not trust the incoming
-- target_url's `visit=` value. Resolve the inviter's current server-side
-- friend_code and stamp it onto room/garden/park invite URLs before insert.

create or replace function public.invite_friend_to_current_place(
  p_friend_code text,
  p_invite_type text,
  p_target_url text,
  p_target_session_id uuid default null,
  p_garden_id text default null,
  p_room_id text default null
)
returns table (
  invite_id uuid,
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inviter_profile_id uuid := auth.uid();
  v_recipient_profile_id uuid;
  v_friend_code text := upper(trim(coalesce(p_friend_code, '')));
  v_invite_type text := lower(trim(coalesce(p_invite_type, '')));
  v_target_url text := trim(coalesce(p_target_url, ''));
  v_host_friend_code text;
  v_existing_invite_id uuid;
  v_existing_expires_at timestamptz;
begin
  if v_inviter_profile_id is null then
    raise exception 'sign in required';
  end if;

  if v_invite_type not in ('room', 'garden', 'park', 'party', 'game') then
    raise exception 'invalid invite type';
  end if;

  if v_target_url not like '/app/%' or char_length(v_target_url) > 512 then
    raise exception 'invalid target url';
  end if;

  select recipient_profile.id
    into v_recipient_profile_id
    from public.profiles as recipient_profile
   where upper(recipient_profile.friend_code) = v_friend_code
   limit 1;

  if v_recipient_profile_id is null then
    raise exception 'friend not found';
  end if;

  if v_recipient_profile_id = v_inviter_profile_id then
    raise exception 'cannot invite yourself';
  end if;

  if not exists (
    select 1
      from public.friendships as friendship
     where friendship.status = 'accepted'
       and least(friendship.requester_id, friendship.friend_id) = least(v_inviter_profile_id, v_recipient_profile_id)
       and greatest(friendship.requester_id, friendship.friend_id) = greatest(v_inviter_profile_id, v_recipient_profile_id)
  ) then
    raise exception 'only friends can be invited';
  end if;

  select inviter_profile.friend_code
    into v_host_friend_code
    from public.profiles as inviter_profile
   where inviter_profile.id = v_inviter_profile_id;

  if v_host_friend_code is null or trim(v_host_friend_code) = '' then
    raise exception 'host friend code is missing';
  end if;

  if v_invite_type in ('room', 'garden', 'park') then
    v_target_url := regexp_replace(v_target_url, '([?&])visit=[^&]*&?', '\1', 'g');
    v_target_url := regexp_replace(v_target_url, '[?&]$', '');
    v_target_url := v_target_url ||
      case when position('?' in v_target_url) > 0 then '&' else '?' end ||
      'visit=' || v_host_friend_code;
  end if;

  if v_target_url not like '/app/%' or char_length(v_target_url) > 512 then
    raise exception 'invalid target url';
  end if;

  update public.current_place_invites as place_invite
     set target_session_id = p_target_session_id,
         host_profile_id = v_inviter_profile_id,
         host_friend_code = v_host_friend_code,
         garden_id = nullif(trim(coalesce(p_garden_id, '')), ''),
         room_id = nullif(trim(coalesce(p_room_id, '')), ''),
         expires_at = now() + interval '15 minutes',
         accepted_at = null,
         declined_at = null
   where place_invite.inviter_id = v_inviter_profile_id
     and place_invite.recipient_id = v_recipient_profile_id
     and place_invite.invite_type = v_invite_type
     and place_invite.target_url = v_target_url
     and place_invite.status = 'pending'
   returning place_invite.id, place_invite.expires_at
        into v_existing_invite_id, v_existing_expires_at;

  if v_existing_invite_id is not null then
    invite_id := v_existing_invite_id;
    status := 'pending';
    expires_at := v_existing_expires_at;
    return next;
    return;
  end if;

  insert into public.current_place_invites as inserted_invite (
    inviter_id,
    recipient_id,
    invite_type,
    target_url,
    target_session_id,
    host_profile_id,
    host_friend_code,
    garden_id,
    room_id
  )
  values (
    v_inviter_profile_id,
    v_recipient_profile_id,
    v_invite_type,
    v_target_url,
    p_target_session_id,
    v_inviter_profile_id,
    v_host_friend_code,
    nullif(trim(coalesce(p_garden_id, '')), ''),
    nullif(trim(coalesce(p_room_id, '')), '')
  )
  returning inserted_invite.id, inserted_invite.expires_at
       into invite_id, expires_at;

  status := 'pending';
  return next;
end;
$$;

with normalized_invites as (
  select
    place_invite.id,
    (
      regexp_replace(
        regexp_replace(place_invite.target_url, '([?&])visit=[^&]*&?', '\1', 'g'),
        '[?&]$',
        ''
      ) ||
      case
        when position('?' in regexp_replace(regexp_replace(place_invite.target_url, '([?&])visit=[^&]*&?', '\1', 'g'), '[?&]$', '')) > 0
          then '&'
        else '?'
      end ||
      'visit=' || place_invite.host_friend_code
    ) as canonical_target_url
  from public.current_place_invites as place_invite
  where place_invite.status = 'pending'
    and place_invite.invite_type in ('room', 'garden', 'park')
    and place_invite.host_friend_code is not null
    and trim(place_invite.host_friend_code) <> ''
)
update public.current_place_invites as place_invite
   set target_url = normalized_invites.canonical_target_url
  from normalized_invites
 where place_invite.id = normalized_invites.id
   and place_invite.target_url <> normalized_invites.canonical_target_url
   and not exists (
     select 1
       from public.current_place_invites as conflicting_invite
      where conflicting_invite.id <> place_invite.id
        and conflicting_invite.inviter_id = place_invite.inviter_id
        and conflicting_invite.recipient_id = place_invite.recipient_id
        and conflicting_invite.invite_type = place_invite.invite_type
        and conflicting_invite.target_url = normalized_invites.canonical_target_url
        and conflicting_invite.status = 'pending'
   );

revoke all on function public.invite_friend_to_current_place(text, text, text, uuid, text, text) from public;
grant execute on function public.invite_friend_to_current_place(text, text, text, uuid, text, text) to authenticated, service_role;
