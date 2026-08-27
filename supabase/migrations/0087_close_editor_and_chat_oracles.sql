-- 0087_close_editor_and_chat_oracles.sql
--
-- Three permission-check helpers were callable directly by clients.
--
-- THE ISSUE. These are SECURITY DEFINER, and each takes the SUBJECT of the
-- check as a parameter rather than deriving it from auth.uid():
--
--     is_room_editor(host_profile_id, room_id, caller_profile_id)
--     is_garden_editor(host_profile_id, garden_id, caller_profile_id)
--     can_chat_in_host_place(host_profile_id, sender_profile_id)
--
-- That combination makes them oracles. Because they run as owner they answer
-- authoritatively, ignoring RLS; because the subject is an argument, a signed
-- in player can ask about anyone. Given two profile ids you could enumerate
-- who may decorate whose room or garden, and who may speak in whose place —
-- the same relationships 0086 just stopped anyone reading out of
-- room_decorator_grants and garden_decorator_grants. Closing the tables while
-- leaving these open would only have made the leak slower.
--
-- This is the pattern 0082 closed for is_email_banned / is_phone_banned: a
-- DEFINER predicate about someone else, handed to the client.
--
-- THE FIX. Revoke the client grants. Nothing is lost:
--
--   * No client code calls any of the three — every caller is server side.
--   * Every internal caller is itself SECURITY DEFINER and so executes as
--     owner, which is unaffected by a grant to `authenticated`:
--       is_room_editor         <- save_room_placements, save_room_surfaces
--       is_garden_editor       <- save_garden_decor, save_garden_plots,
--                                 apply_garden_plot_action
--       can_chat_in_host_place <- send_place_chat_message,
--                                 get_place_chat_messages
--
-- Decorating and chatting therefore behave exactly as before; only the
-- ability to ask the question about a third party goes away.

/* `from public` first, and not as a formality. EXECUTE on a function is
   granted to PUBLIC by default, and a revoke naming only `authenticated`
   leaves that default in place — the role keeps access through PUBLIC and
   the revoke silently does nothing. That is the same shape as the bug 0085
   had to repair on profiles.phone, where a column revoke could not subtract
   from a table-level grant. These three were revoked from public by their
   original migrations, so this is belt and braces; it also makes the file
   correct on its own rather than dependent on that having happened. */
revoke all on function public.is_room_editor(uuid, text, uuid) from public;
revoke all on function public.is_garden_editor(uuid, text, uuid) from public;
revoke all on function public.can_chat_in_host_place(uuid, uuid) from public;

revoke execute on function public.is_room_editor(uuid, text, uuid) from authenticated, anon;
revoke execute on function public.is_garden_editor(uuid, text, uuid) from authenticated, anon;
revoke execute on function public.can_chat_in_host_place(uuid, uuid) from authenticated, anon;

comment on function public.is_room_editor(uuid, text, uuid) is
  'INTERNAL ONLY. SECURITY DEFINER predicate taking the caller identity as a parameter, so a direct client grant turns it into an oracle for who may decorate whose room. Called from save_room_placements / save_room_surfaces, which are DEFINER and so unaffected by this revoke. Keep revoked from authenticated and anon.';

comment on function public.is_garden_editor(uuid, text, uuid) is
  'INTERNAL ONLY. Same reasoning as is_room_editor. Called from save_garden_decor, save_garden_plots and apply_garden_plot_action, all DEFINER. Keep revoked from authenticated and anon.';

comment on function public.can_chat_in_host_place(uuid, uuid) is
  'INTERNAL ONLY. SECURITY DEFINER predicate taking the sender identity as a parameter; a client grant would let anyone ask who may speak in whose place. Called from send_place_chat_message and get_place_chat_messages, both DEFINER. Keep revoked from authenticated and anon.';
