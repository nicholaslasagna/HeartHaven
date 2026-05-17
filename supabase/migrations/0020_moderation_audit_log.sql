-- 0020_moderation_audit_log.sql
--
-- A simple append-only log of severe moderation events: auto-quarantines,
-- severe-flag triggers, manual moderator decisions. Gives admins a trail
-- they can investigate without joining a dozen tables.
--
-- The client never reads this — only service-role admin tooling. The only
-- write path is via a SECURITY DEFINER function that is callable by
-- authenticated users so the client can log its OWN auto-quarantines
-- (since those happen on the sender's device before any moderator looks).

create table if not exists public.moderation_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references auth.users (id) on delete set null,
  actor_friend_code text,
  /** What happened. Free-form strings keep the table forward-compatible. */
  event text not null check (char_length(event) between 1 and 64),
  /** Severity for triage. */
  severity text not null default 'info' check (severity in ('info', 'warn', 'severe')),
  /** Optional context blob — chat excerpt, scene, reason note. */
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists moderation_audit_log_actor_idx
  on public.moderation_audit_log (actor_profile_id, created_at desc);

create index if not exists moderation_audit_log_severity_idx
  on public.moderation_audit_log (severity, created_at desc);

alter table public.moderation_audit_log enable row level security;

-- No SELECT / UPDATE / DELETE for authenticated users. Service role
-- bypasses RLS for moderator dashboards.

create or replace function public.log_moderation_event(
  event text,
  severity text,
  context jsonb,
  actor_friend_code text default null
) returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  acting_uid uuid := auth.uid();
  recent_count integer;
begin
  -- Rate limit: the local client could try to spam log entries to drown
  -- out real signal. Cap at 60 events per minute per actor.
  if acting_uid is not null then
    select count(*) into recent_count
    from public.moderation_audit_log
    where actor_profile_id = acting_uid
      and created_at >= now() - interval '60 seconds';
    if recent_count >= 60 then
      return;
    end if;
  end if;
  insert into public.moderation_audit_log (actor_profile_id, actor_friend_code, event, severity, context)
  values (acting_uid, log_moderation_event.actor_friend_code, log_moderation_event.event,
          coalesce(log_moderation_event.severity, 'info'), coalesce(log_moderation_event.context, '{}'::jsonb));
end;
$$;

grant execute on function public.log_moderation_event(text, text, jsonb, text) to authenticated;

comment on table public.moderation_audit_log is
  'Append-only audit log of safety events. Service-role only for reads. Writers call public.log_moderation_event() which rate-limits.';
