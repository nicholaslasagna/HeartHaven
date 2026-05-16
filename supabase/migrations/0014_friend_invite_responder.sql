-- 0014_friend_invite_responder.sql
--
-- When the recipient accepts an invite, we want the SENDER's friend list to
-- pick up the new friend automatically — no manual re-add. That needs the
-- recipient's display name on the row at response time, so this migration
-- adds two columns the recipient fills in when they accept / decline.

alter table public.friend_invites
  add column if not exists responder_code text,
  add column if not exists responder_display_name text;

comment on column public.friend_invites.responder_code is
  'The recipient code that responded to the invite — usually equal to to_code, but stored explicitly for the realtime UPDATE consumer.';

comment on column public.friend_invites.responder_display_name is
  'Recipient public username at response time. Sender reads this to add the recipient to their friend list.';
