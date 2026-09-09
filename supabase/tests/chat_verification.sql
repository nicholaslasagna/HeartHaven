-- Chat verification (run after 0097).
--
-- Chat is not stored. It is delivered over Realtime broadcast and exists only
-- in the clients that were present to hear it. What still goes through the
-- server is permission: authorize_place_chat decides whether a keeper may
-- speak, which is where the mute and the flood guard are enforced.
--
-- Verified on a scratch PostgreSQL 16 cluster before shipping: the message
-- table dropped, a muted keeper refused, the mute lifting restoring speech,
-- the eleventh message in ten seconds refused, and the window resetting.
--
-- Prerequisites: migration 0097 applied.

-- 1) THE point: no message is stored anywhere. Expected: message_table_gone
--    true, and the only chat table is the counter.
select
  to_regclass('public.place_chat_messages') is null as message_table_gone,
  (select coalesce(string_agg(tablename, ', '), 'none')
     from pg_tables where schemaname = 'public' and tablename like '%chat%') as chat_tables;

-- 2) The counter holds counts, never content. Expected: profile_id,
--    window_started_at, sent_in_window — and nothing resembling a message.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'chat_rate_counters'
 order by ordinal_position;

-- 3) Enforcement is server-side. Expected: both true.
select
  prosrc like '%chat_quarantined_until%' as mute_enforced,
  prosrc like '%chat_rate_counters%'     as flood_guarded
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname = 'authorize_place_chat';

-- 4) The old write paths are gone. Expected: all null.
select
  to_regprocedure('public.send_place_chat_message(text,text,text,text)') as send_fn,
  to_regprocedure('public.get_place_chat_messages(text,text,text,integer)') as history_fn,
  to_regprocedure('public.clear_place_chat(text,text,text)') as clear_fn;

-- 5) Anyone currently muted. They cannot get an authorization, whatever
--    their client believes.
select id, friend_code, chat_quarantined_until
  from public.profiles
 where chat_quarantined_until is not null
   and chat_quarantined_until > now()
 order by chat_quarantined_until desc;

-- 6) Counter size, as a buildup check. One row per keeper who has ever
--    chatted, and it never grows past that however much anyone types.
select count(*) as counter_rows,
       pg_size_pretty(pg_total_relation_size('public.chat_rate_counters')) as size
  from public.chat_rate_counters;

-- 7) REMAINING GAP, worth knowing. Sending is ultimately the client
--    broadcasting on the channel, so a modified client can skip the
--    authorization call above. Closing that means authorizing the Realtime
--    channel itself — a policy on realtime.messages restricting broadcast on
--    a place topic to keepers who are not muted — which is a Realtime
--    configuration change rather than a schema one. The check here is only
--    that the server-side decision exists and is correct.
