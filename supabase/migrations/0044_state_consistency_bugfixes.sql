-- 0044_state_consistency_bugfixes.sql
--
-- Follow-up for live production fixes:
--   1. Make random code generation independent of search_path by pinning
--      pgcrypto to the extensions schema and schema-qualifying calls.
--   2. Keep party invite generation collision-safe after 0043 has already
--      been applied to production.
--   3. Store stable profile ids on friend_invites so username/display-name
--      changes cannot make old invite snapshots look like different people.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  alter extension pgcrypto set schema extensions;
exception
  when others then
    null;
end;
$$;

create or replace function public.generate_friend_code()
returns text
language plpgsql
as $$
declare
  v_letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_digits constant text := '23456789';
  v_code text;
  v_attempts integer := 0;
  i integer;
begin
  loop
    v_attempts := v_attempts + 1;
    v_code := 'HH-';

    for i in 1..5 loop
      v_code := v_code || substr(v_letters, (get_byte(extensions.gen_random_bytes(1), 0) % length(v_letters)) + 1, 1);
    end loop;

    v_code := v_code || '-';

    for i in 1..3 loop
      v_code := v_code || substr(v_digits, (get_byte(extensions.gen_random_bytes(1), 0) % length(v_digits)) + 1, 1);
    end loop;

    if not exists (select 1 from public.profiles where friend_code = v_code) then
      return v_code;
    end if;

    if v_attempts >= 16 then
      raise exception 'unable to generate unique friend code after % attempts', v_attempts;
    end if;
  end loop;
end;
$$;

create or replace function public.generate_party_invite_code()
returns text
language plpgsql
as $$
declare
  v_letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code text := '';
  v_bytes bytea;
  v_num integer;
  i integer;
begin
  for i in 1..6 loop
    v_code := v_code || substr(v_letters, (get_byte(extensions.gen_random_bytes(1), 0) % length(v_letters)) + 1, 1);
  end loop;

  v_bytes := extensions.gen_random_bytes(2);
  v_num := ((get_byte(v_bytes, 0) * 256) + get_byte(v_bytes, 1)) % 10000;

  return 'HH-' || v_code || '-' || lpad(v_num::text, 4, '0');
end;
$$;

alter table public.game_sessions
  alter column invite_code set default public.generate_party_invite_code();

alter table public.friend_invites
  add column if not exists from_profile_id uuid references public.profiles (id) on delete cascade,
  add column if not exists to_profile_id uuid references public.profiles (id) on delete cascade;

update public.friend_invites fi
   set from_profile_id = p.id
  from public.profiles p
 where fi.from_profile_id is null
   and upper(p.friend_code) = upper(fi.from_code);

update public.friend_invites fi
   set to_profile_id = p.id
  from public.profiles p
 where fi.to_profile_id is null
   and upper(p.friend_code) = upper(fi.to_code);

update public.friend_invites
   set from_profile_id = sender_profile_id
 where from_profile_id is null;

create index if not exists friend_invites_from_profile_idx
  on public.friend_invites (from_profile_id, created_at desc)
  where from_profile_id is not null;

create index if not exists friend_invites_to_profile_idx
  on public.friend_invites (to_profile_id, created_at desc)
  where to_profile_id is not null;

with ranked as (
  select
    id,
    row_number() over (
      partition by from_profile_id, to_profile_id
      order by created_at desc, id desc
    ) as rn
  from public.friend_invites
  where status = 'pending'
    and from_profile_id is not null
    and to_profile_id is not null
)
update public.friend_invites fi
   set status = 'cancelled',
       responded_at = coalesce(fi.responded_at, now())
  from ranked r
 where fi.id = r.id
   and r.rn > 1;

create unique index if not exists friend_invites_one_pending_profile_pair
  on public.friend_invites (from_profile_id, to_profile_id)
  where status = 'pending'
    and from_profile_id is not null
    and to_profile_id is not null;

comment on column public.friend_invites.from_profile_id is
  'Stable sender profile id for invite reconciliation. Code/name snapshots remain display metadata only.';

comment on column public.friend_invites.to_profile_id is
  'Stable recipient profile id for invite reconciliation. Code/name snapshots remain display metadata only.';

create or replace function public.upsert_friendship_pair(
  p_requester_id uuid,
  p_friend_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_requester_id is null or p_friend_id is null or p_requester_id = p_friend_id then
    return null;
  end if;

  -- Reactivate/update first. `friendships_pair_unique` is an expression
  -- unique index, not a table constraint, so it cannot be targeted with
  -- `ON CONFLICT ON CONSTRAINT`. Update-first + insert-DO-NOTHING is the
  -- safe idempotent path for both re-adds and concurrent accepts.
  update public.friendships
     set status = 'accepted',
         updated_at = now()
   where least(requester_id, friend_id) = least(p_requester_id, p_friend_id)
     and greatest(requester_id, friend_id) = greatest(p_requester_id, p_friend_id)
   returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.friendships (requester_id, friend_id, status)
  values (p_requester_id, p_friend_id, 'accepted')
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  -- If another transaction inserted the unordered pair between our update
  -- and insert, normalize it now and return the existing id.
  update public.friendships
     set status = 'accepted',
         updated_at = now()
   where least(requester_id, friend_id) = least(p_requester_id, p_friend_id)
     and greatest(requester_id, friend_id) = greatest(p_requester_id, p_friend_id)
   returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_friendship_pair(uuid, uuid) from public;
grant execute on function public.upsert_friendship_pair(uuid, uuid) to service_role;

with accepted_pairs as (
  select distinct
    coalesce(fi.from_profile_id, fi.sender_profile_id) as from_id,
    coalesce(fi.to_profile_id, p_to.id) as to_id
  from public.friend_invites fi
  left join public.profiles p_to on upper(p_to.friend_code) = upper(fi.to_code)
  where fi.status = 'accepted'
),
valid_pairs as (
  select from_id, to_id
  from accepted_pairs
  where from_id is not null
    and to_id is not null
    and from_id <> to_id
)
select public.upsert_friendship_pair(from_id, to_id)
from valid_pairs;

create or replace function public.sync_friendship_from_friend_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from uuid;
  v_to uuid;
begin
  if new.status <> 'accepted' or coalesce(old.status, '') = 'accepted' then
    return new;
  end if;

  v_from := coalesce(new.from_profile_id, new.sender_profile_id);
  v_to := new.to_profile_id;

  if v_to is null then
    select id into v_to
    from public.profiles
    where upper(friend_code) = upper(new.to_code)
    limit 1;
  end if;

  if v_from is null or v_to is null or v_from = v_to then
    return new;
  end if;

  perform public.upsert_friendship_pair(v_from, v_to);

  return new;
end;
$$;

drop trigger if exists friend_invites_sync_friendship on public.friend_invites;
create trigger friend_invites_sync_friendship
  after update of status on public.friend_invites
  for each row
  execute function public.sync_friendship_from_friend_invite();

create or replace function public.get_my_friends()
returns table (
  profile_id uuid,
  friend_code text,
  display_name text
)
language sql
security definer
set search_path = public
as $$
  select distinct on (p.id)
    p.id as profile_id,
    p.friend_code,
    coalesce(nullif(trim(p.username), ''), nullif(trim(p.display_name), ''), 'Keeper') as display_name
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = auth.uid() then f.friend_id else f.requester_id end
  where auth.uid() in (f.requester_id, f.friend_id)
    and f.status = 'accepted'
    and p.friend_code is not null
  order by p.id, f.updated_at desc, f.created_at desc;
$$;

revoke all on function public.get_my_friends() from public;
grant execute on function public.get_my_friends() to authenticated, service_role;

create or replace function public.remove_friend_by_code(p_friend_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_code text := upper(trim(coalesce(p_friend_code, '')));
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;

  select id into v_target
  from public.profiles
  where upper(friend_code) = v_code
  limit 1;

  if v_target is null or v_target = v_uid then
    return false;
  end if;

  delete from public.friendships
  where least(requester_id, friend_id) = least(v_uid, v_target)
    and greatest(requester_id, friend_id) = greatest(v_uid, v_target);

  update public.friend_invites
     set status = 'cancelled',
         responded_at = coalesce(responded_at, now())
   where status = 'pending'
     and (
       (coalesce(from_profile_id, sender_profile_id) = v_uid and (to_profile_id = v_target or upper(to_code) = v_code))
       or
       (coalesce(from_profile_id, sender_profile_id) = v_target and (to_profile_id = v_uid or upper(from_code) = v_code))
     );

  return true;
end;
$$;

revoke all on function public.remove_friend_by_code(text) from public;
grant execute on function public.remove_friend_by_code(text) to authenticated, service_role;
