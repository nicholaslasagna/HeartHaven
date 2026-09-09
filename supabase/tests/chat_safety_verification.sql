-- Chat mute, flood guard and clearing verification (run after 0096).
--
-- Verified on a scratch PostgreSQL 16 cluster before shipping: an ordinary
-- message sends, a muted keeper is refused, an expired mute stops blocking,
-- the eleventh message in ten seconds is refused with ten stored, and
-- clearing removes a place's rows and returns the count.
--
-- Prerequisites: migration 0096 applied.

-- 1) THE one that mattered: the mute is enforced where the message is
--    written. profiles.chat_quarantined_until has existed since 0010 and
--    nothing read it, so muting somebody did nothing. Expected: true.
select prosrc like '%chat_quarantined_until%' as mute_enforced,
       prosrc like '%chat_rate_limit%'        as flood_guarded
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname = 'send_place_chat_message';

-- 2) Anyone currently muted. These keepers can no longer send, whatever
--    their client believes.
select id, friend_code, chat_quarantined_until
  from public.profiles
 where chat_quarantined_until is not null
   and chat_quarantined_until > now()
 order by chat_quarantined_until desc;

-- 3) Stored chat should stay small: it is cleared whenever anyone joins a
--    place, and is never read back. A place with a large backlog is one
--    nobody has entered since the rows were written.
select
  host_friend_code,
  place_type,
  place_id,
  count(*)          as messages,
  min(created_at)   as oldest,
  max(created_at)   as newest
  from public.place_chat_messages
 group by host_friend_code, place_type, place_id
having count(*) > 50
 order by count(*) desc
 limit 20;

-- 4) Total rows, as a plain buildup check. Expected: small, and not growing
--    steadily week on week.
select count(*) as stored_messages,
       count(*) filter (where created_at < now() - interval '7 days') as older_than_a_week
  from public.place_chat_messages;

-- 5) Sweep for places nobody has revisited. Clearing happens on join, so a
--    place that is never entered again keeps its rows. Safe to run: these
--    are never read back by the app.
-- delete from public.place_chat_messages where created_at < now() - interval '7 days';
