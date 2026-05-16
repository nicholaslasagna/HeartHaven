-- 0016_report_rate_limit.sql
--
-- Server-side rate limiting for `moderator_reports` so a single user
-- can't flood the moderation queue or weaponize the report system to
-- harass innocent keepers.
--
-- Caps:
--   • 8 reports per 5 minutes per reporter
--   • 40 reports per 24 hours per reporter
--
-- A keeper genuinely reporting back-to-back chat content can hit ~3 in a
-- few minutes; 8/5min leaves real room for legitimate use. A keeper
-- intentionally weaponizing the system trips it quickly.

create or replace function public.can_insert_moderator_report(
  reporter_uid uuid
) returns boolean
  language plpgsql
  stable
  security invoker
as $$
declare
  recent_count integer;
  daily_count integer;
begin
  select count(*) into recent_count
  from public.moderator_reports
  where reporter_profile_id = reporter_uid
    and created_at >= now() - interval '5 minutes';
  if recent_count >= 8 then
    return false;
  end if;

  select count(*) into daily_count
  from public.moderator_reports
  where reporter_profile_id = reporter_uid
    and created_at >= now() - interval '24 hours';
  if daily_count >= 40 then
    return false;
  end if;

  return true;
end;
$$;

drop policy if exists "keepers insert their own reports" on public.moderator_reports;
create policy "keepers insert their own reports"
  on public.moderator_reports
  for insert
  to authenticated
  with check (
    reporter_profile_id = auth.uid()
    and public.can_insert_moderator_report(reporter_profile_id)
  );

comment on function public.can_insert_moderator_report is
  'Rate-limit guard for moderator_reports INSERTs. Caps to 8/5min, 40/24h per reporter.';
