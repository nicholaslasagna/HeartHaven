-- 0098_server_side_auto_quarantine.sql
--
-- Make the auto-quarantine survive a cleared browser.
--
-- When chat moderation hard-blocks a message — the predatory and explicit
-- patterns — the sender is quarantined: their outgoing chat is muted for a
-- cooldown that escalates to 24 hours on a third strike. That quarantine was
-- written to local storage and nowhere else. Clearing site data lifted it,
-- and it never followed the keeper to another device or browser.
--
-- 0097 moved the mute check to the server, where authorize_place_chat reads
-- profiles.chat_quarantined_until. That closed the enforcement gap but left
-- the setting gap: the only thing that ever wrote that column was a
-- moderator by hand, so an auto-quarantine still never reached it.
--
-- WHY THE CLIENT CANNOT JUST WRITE IT. 0019 protects the column with a
-- trigger, correctly — a keeper must not be able to lift their own mute. The
-- trigger exempts only the service role, and auth.uid() is still set inside a
-- SECURITY DEFINER function, so even that could not set it.
--
-- The trigger now also stands aside for a transaction that has explicitly
-- declared itself a moderation action, which only flag_severe_chat does. That
-- function acts on auth.uid() and nobody else, so the strongest thing a
-- keeper can do with it is silence themselves — and it only ever EXTENDS a
-- mute, never shortens one, so it cannot be used to clear a moderator's.

create or replace function public.protect_profile_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Service role / postgres: unrestricted, as before.
  if auth.uid() is null then
    return new;
  end if;

  /* A moderation action inside this transaction. Set only by
     flag_severe_chat, which can act on nobody but the caller. */
  if coalesce(current_setting('hearthaven.moderation_action', true), '') = 'on' then
    return new;
  end if;

  if new.moderation_status is distinct from old.moderation_status then
    raise exception 'profiles.moderation_status is moderator-managed' using errcode = '42501';
  end if;
  if new.chat_quarantined_until is distinct from old.chat_quarantined_until then
    raise exception 'profiles.chat_quarantined_until is moderator-managed' using errcode = '42501';
  end if;
  if new.chat_severe_flag_count is distinct from old.chat_severe_flag_count then
    raise exception 'profiles.chat_severe_flag_count is moderator-managed' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.flag_severe_chat()
returns table (quarantined_until timestamptz, severe_flag_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_self uuid := auth.uid();
  v_count integer;
  v_until timestamptz;
begin
  if v_self is null then
    raise exception 'sign in required';
  end if;

  -- Mirrors quarantineSelf in src/lib/game/safety.ts: half an hour, and a
  -- full day once a keeper reaches a third severe flag.
  select coalesce(flagged.chat_severe_flag_count, 0) + 1
    into v_count
    from public.profiles as flagged
   where flagged.id = v_self;

  if v_count is null then
    raise exception 'profile not found';
  end if;

  v_until := now() + case when v_count >= 3 then interval '24 hours' else interval '30 minutes' end;

  perform set_config('hearthaven.moderation_action', 'on', true);

  update public.profiles as target
     set chat_severe_flag_count = v_count,
         -- Only ever extends. A keeper cannot shorten a mute a moderator set
         -- by tripping the filter again.
         chat_quarantined_until = greatest(coalesce(target.chat_quarantined_until, v_until), v_until)
   where target.id = v_self
   returning target.chat_quarantined_until, target.chat_severe_flag_count
   into quarantined_until, severe_flag_count;

  perform set_config('hearthaven.moderation_action', 'off', true);

  return next;
end;
$$;

comment on function public.flag_severe_chat() is
  'Records a severe chat flag against the CALLER and extends their own mute — 30 minutes, or 24 hours from a third flag. Acts on auth.uid() only, so the most it can do is silence the caller, and it never shortens an existing mute. Called when chat moderation hard-blocks a message, so the quarantine survives a cleared browser instead of living only in local storage.';

revoke all on function public.flag_severe_chat() from public;
grant execute on function public.flag_severe_chat() to authenticated, service_role;
