-- 0056_love_notes_partner_only.sql
--
-- Love notes are intended for partnered keepers ONLY — they're the
-- intimate-correspondence surface of the "world for two" promise. Today
-- the love_notes RLS lets ANY authenticated user insert a note to ANY
-- recipient, which means a stranger could push a note into your inbox.
-- This migration:
--
--   1. Tightens the INSERT policy so the recipient MUST be the sender's
--      currently-accepted partner.
--   2. Adds a SECURITY DEFINER RPC `send_love_note_to_partner` that
--      handles the partner lookup + insert in one round-trip — the UI
--      just passes subject/body/scheduled_for, not a recipient.
--   3. Adds `get_love_notes_with_partner()` for the mailbox to read both
--      sent + received notes between the caller and their partner.
--   4. Adds `mark_love_note_read(id)` for read receipts.
--
-- The existing love_notes columns from 0001 already include
-- `partner_link_id` — we populate it from the active link so future
-- queries can scope on it cheaply.

-- ------------------------------------------------------------------------
-- 1. Tighten INSERT policy: recipient must be an accepted partner
-- ------------------------------------------------------------------------

drop policy if exists "Players send love notes" on public.love_notes;
create policy "Partners send love notes"
  on public.love_notes
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1
      from public.partner_links pl
      where pl.status = 'accepted'
        and (
          (pl.requester_id = auth.uid() and pl.partner_id = love_notes.recipient_id)
          or (pl.partner_id = auth.uid() and pl.requester_id = love_notes.recipient_id)
        )
    )
  );

-- ------------------------------------------------------------------------
-- 2. send_love_note_to_partner — single-call send
-- ------------------------------------------------------------------------

create or replace function public.send_love_note_to_partner(
  p_subject text,
  p_body text,
  p_scheduled_for timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_partner_id uuid;
  v_link_id uuid;
  v_note_id uuid;
  v_subject text;
  v_body text;
begin
  if v_sender is null then
    raise exception 'sign in required';
  end if;
  v_subject := nullif(trim(coalesce(p_subject, '')), '');
  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_subject is null then raise exception 'subject is required'; end if;
  if v_body is null then raise exception 'body is required'; end if;
  if char_length(v_subject) > 120 then raise exception 'subject too long (max 120 chars)'; end if;
  if char_length(v_body) > 4000 then raise exception 'body too long (max 4000 chars)'; end if;

  -- Find the caller's active partner. Bail out with a kind error if they
  -- aren't partnered — the UI surfaces it as "link up with a partner
  -- first".
  select
    pl.id,
    case when pl.requester_id = v_sender then pl.partner_id else pl.requester_id end
    into v_link_id, v_partner_id
  from public.partner_links pl
  where pl.status = 'accepted'
    and v_sender in (pl.requester_id, pl.partner_id)
  limit 1;

  if v_partner_id is null then
    raise exception 'link up with a partner before sending love notes';
  end if;

  insert into public.love_notes (
    sender_id, recipient_id, partner_link_id, subject, body, scheduled_for, is_private
  ) values (
    v_sender, v_partner_id, v_link_id, v_subject, v_body, p_scheduled_for, true
  )
  returning id into v_note_id;

  return v_note_id;
end;
$$;

revoke all on function public.send_love_note_to_partner(text, text, timestamptz) from public;
grant execute on function public.send_love_note_to_partner(text, text, timestamptz) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 3. get_love_notes_with_partner — mailbox read
-- ------------------------------------------------------------------------
-- Returns every love note between the caller and their current partner,
-- newest first. Includes a `direction` field ('sent' vs 'received') so
-- the UI can group + style accordingly without an extra lookup.

create or replace function public.get_love_notes_with_partner(p_limit integer default 50)
returns table (
  id uuid,
  sender_id uuid,
  recipient_id uuid,
  subject text,
  body text,
  scheduled_for timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz,
  direction text   -- 'sent' or 'received'
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_partner_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if v_uid is null then
    return;
  end if;

  select
    case when pl.requester_id = v_uid then pl.partner_id else pl.requester_id end
    into v_partner_id
  from public.partner_links pl
  where pl.status = 'accepted'
    and v_uid in (pl.requester_id, pl.partner_id)
  limit 1;

  if v_partner_id is null then
    return; -- no partner, no notes
  end if;

  return query
    select
      n.id, n.sender_id, n.recipient_id, n.subject, n.body,
      n.scheduled_for, n.delivered_at, n.read_at, n.created_at,
      case when n.sender_id = v_uid then 'sent' else 'received' end
    from public.love_notes n
    where (n.sender_id = v_uid and n.recipient_id = v_partner_id)
       or (n.sender_id = v_partner_id and n.recipient_id = v_uid)
    order by n.created_at desc
    limit v_limit;
end;
$$;

revoke all on function public.get_love_notes_with_partner(integer) from public;
grant execute on function public.get_love_notes_with_partner(integer) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 4. mark_love_note_read — flips read_at for received notes
-- ------------------------------------------------------------------------

create or replace function public.mark_love_note_read(p_note_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;
  update public.love_notes
     set read_at = coalesce(read_at, now()),
         delivered_at = coalesce(delivered_at, now())
   where id = p_note_id
     and recipient_id = v_uid;
  return found;
end;
$$;

revoke all on function public.mark_love_note_read(uuid) from public;
grant execute on function public.mark_love_note_read(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 5. Realtime publication so the partner sees new notes live
-- ------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.love_notes;
    exception when others then null;
    end;
  end if;
end $$;
