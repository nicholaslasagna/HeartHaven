-- 0019_profile_sensitive_columns.sql
--
-- The existing UPDATE policy on `profiles` is `auth.uid() = id` — which lets
-- a user update ANY column on their own row. That includes sensitive
-- moderation columns added in 0010:
--
--   • moderation_status — 'active' / 'review' / 'quarantined' / 'banned'
--   • chat_quarantined_until — the timestamp until which the user is muted
--   • chat_severe_flag_count — counter incremented on every severe flag
--
-- Without protection, a quarantined keeper can flip their own status back
-- to 'active' and the local quarantine UI would believe them. Lock those
-- columns down so only the service-role can change them.

create or replace function public.protect_profile_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only the service role bypasses RLS. Authenticated users hitting this
  -- trigger must not be touching the protected columns.
  if auth.uid() is null then
    -- Service role / postgres role — let it through.
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

drop trigger if exists profiles_protect_sensitive on public.profiles;
create trigger profiles_protect_sensitive
  before update on public.profiles
  for each row execute function public.protect_profile_sensitive_columns();

comment on function public.protect_profile_sensitive_columns is
  'Prevents authenticated users from updating moderator-managed columns on profiles. Service role bypasses RLS so it skips this check.';
