-- Verification for the DEFINER predicate oracles (run after 0087 and 0088).
--
-- Five SECURITY DEFINER functions took their subject as a parameter rather
-- than deriving it from auth.uid(), and were client-callable. Two of them
-- (are_friends, is_recipient_blocking) had never been revoked from PUBLIC,
-- so they answered to `anon` — confirmed live against this database before
-- the fix, returning 200 and a boolean with only the anon key.
--
-- Prerequisites: migrations 0087 and 0088 applied.

-- 1) THE decisive check. Expected: no rows. Any row here is a role that can
--    still ask one of these questions about a third party.
select p.proname, r.rolname as can_execute
  from pg_proc p
  cross join lateral (values ('authenticated'), ('anon'), ('public')) as roles(rolname)
  join pg_roles r on r.rolname = roles.rolname
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('are_friends', 'is_recipient_blocking', 'is_room_editor',
                     'is_garden_editor', 'can_chat_in_host_place')
   and has_function_privilege(r.rolname, p.oid, 'execute');

-- 2) PUBLIC is the one that bites: EXECUTE is granted to PUBLIC by default,
--    so a revoke naming only `authenticated` leaves access in place. This
--    lists every function in the schema that still carries the default.
--    Review anything unexpected — note that several helpers legitimately
--    rely on it to be callable inside RLS policies.
select p.proname, p.prosecdef as security_definer
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.prokind = 'f'
   and has_function_privilege('public', p.oid, 'execute')
 order by p.prosecdef desc, p.proname;

-- 3) The self-relative helpers MUST stay executable — they are used inside
--    RLS policies, which evaluate as the querying user. Expected: all true.
--    If any is false, profile reads and session reads will be broken.
select proname,
       has_function_privilege('authenticated', oid, 'execute') as authenticated_can_execute
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('can_profiles_interact', 'is_partner_member',
                   'has_private_content', 'is_game_session_member')
 order by proname;

-- 4) The internal callers must remain SECURITY DEFINER, or revoking the
--    client grants would break decorating, gifting and invites.
--    Expected: all true.
select proname, prosecdef as security_definer
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('save_room_placements', 'save_room_surfaces',
                   'save_garden_decor', 'save_garden_plots',
                   'apply_garden_plot_action', 'send_place_chat_message',
                   'get_place_chat_messages', 'send_inventory_gift',
                   'can_insert_friend_invite')
 order by proname;
