-- 0025_refresh_keeper_names.sql
--
-- One RPC: given a list of friend codes, return the current public
-- username for each. Used by `useSocial` to refresh stale displayName
-- values in the friends list, played-with list, and pending-invite inbox
-- whenever the Friends page mounts or the window regains focus.
--
-- Why this isn't a direct SELECT — `public.profiles` is gated by the
-- `can_profiles_interact(id)` RLS policy from migration 0010, which
-- only lets you read profiles of accounts you've already interacted
-- with. That gating is correct for the general case, but it bites for
-- this UI: the user already knows the friend code (it's in their local
-- friends list) and we just need the current username. A SECURITY
-- DEFINER RPC that returns *only* `friend_code + username` cleanly
-- threads the needle — no extra fields leak, no enumeration.

create or replace function public.refresh_keeper_names(p_friend_codes text[])
returns table (friend_code text, username text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalized text[];
begin
  if p_friend_codes is null or array_length(p_friend_codes, 1) is null then
    return;
  end if;

  -- Cap input size so a malicious caller can't ask us to look up tens of
  -- thousands of codes at once. 200 is double the local cache limit so
  -- legitimate clients always fit.
  if array_length(p_friend_codes, 1) > 200 then
    raise exception 'too many friend codes (max 200)';
  end if;

  -- Uppercase + trim every entry once, then filter to codes that match
  -- the canonical shape. This keeps the join fast and rejects garbage
  -- before it touches the index.
  select array_agg(distinct upper(trim(code)))
    into v_normalized
    from unnest(p_friend_codes) as code
   where upper(trim(code)) ~ '^HH-[A-Z]{5}-[0-9]{3}$';

  if v_normalized is null then
    return;
  end if;

  return query
    select upper(p.friend_code) as friend_code,
           coalesce(p.username, '') as username
      from public.profiles p
     where upper(p.friend_code) = any(v_normalized);
end;
$$;

revoke all on function public.refresh_keeper_names(text[]) from public;
grant execute on function public.refresh_keeper_names(text[]) to authenticated, service_role;
