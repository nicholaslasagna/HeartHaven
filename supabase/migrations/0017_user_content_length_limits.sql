-- 0017_user_content_length_limits.sql
--
-- Defense in depth: enforce length limits on every user-supplied column
-- at the DB layer too. The client already caps these, but a determined
-- caller hitting the REST API directly can send any payload — without
-- server-side caps, they could store megabyte-sized strings.

alter table public.friend_invites
  add constraint friend_invites_from_code_shape check (
    from_code ~ '^HH-[A-Z]{4,6}-[0-9]{2,4}$'
  ),
  add constraint friend_invites_to_code_shape check (
    to_code ~ '^HH-[A-Z]{4,6}-[0-9]{2,4}$'
  ),
  add constraint friend_invites_from_display_name_len check (
    char_length(from_display_name) between 1 and 32
  ),
  add constraint friend_invites_message_len check (
    message is null or char_length(message) <= 240
  );

alter table public.moderator_reports
  add constraint moderator_reports_offender_code_shape check (
    offender_code ~ '^HH-[A-Z]{4,6}-[0-9]{2,4}$'
  ),
  add constraint moderator_reports_reporter_code_shape check (
    reporter_code ~ '^HH-[A-Z]{4,6}-[0-9]{2,4}$'
  ),
  add constraint moderator_reports_offender_name_len check (
    char_length(offender_display_name) between 1 and 32
  ),
  add constraint moderator_reports_details_len check (
    details is null or char_length(details) <= 500
  ),
  add constraint moderator_reports_chat_excerpt_len check (
    chat_excerpt is null or char_length(chat_excerpt) <= 1000
  ),
  add constraint moderator_reports_scene_len check (
    scene is null or char_length(scene) <= 80
  ),
  add constraint moderator_reports_user_agent_len check (
    client_user_agent is null or char_length(client_user_agent) <= 400
  );

-- Profiles got a friend_code column in 0013 but no shape check.
alter table public.profiles
  add constraint profiles_friend_code_shape check (
    friend_code is null or friend_code ~ '^HH-[A-Z]{4,6}-[0-9]{2,4}$'
  ),
  add constraint profiles_username_len check (
    username is null or char_length(username) between 3 and 24
  );

comment on constraint friend_invites_from_code_shape on public.friend_invites is
  'Friend codes must match the canonical HH-XXXXX-NNN shape. Blocks malformed inserts at the DB.';
