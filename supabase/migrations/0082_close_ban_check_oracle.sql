-- 0082_close_ban_check_oracle.sql
--
-- Stop `is_email_banned` / `is_phone_banned` from being an enumeration
-- oracle.
--
-- THE ISSUE. Both were granted to `anon`, so anyone on the internet could
-- call them against any address or phone number and learn whether that
-- person is banned from HeartHaven. No sign-in, no rate limit, and the
-- answer is a clean boolean, which is everything an attacker needs to walk
-- a list of addresses and read off moderation status.
--
-- The sign-up form already took care to return the same generic copy no
-- matter which identifier matched, precisely so it would not become an
-- oracle. That was sound as far as it went, but it only covered the form:
-- the RPC underneath was public, so an attacker could skip the form and ask
-- the database directly.
--
-- Moderation status is sensitive on its own, and the phone variant is worse
-- — it confirms a number is attached to a banned HeartHaven account.
--
-- THE FIX. Both callers are Next server actions, so neither needs a
-- client-side grant: the sign-up gate and the account phone check now run
-- through a service-role client that never leaves the server. Revoking both
-- roles removes the oracle without changing what either flow does.
--
-- `get_ban_summary` deliberately keeps its `anon` grant. It is keyed by a
-- ban's UUID rather than by an identifier you can guess, and the suspended
-- page has to render for a signed-out visitor. An unguessable key is not an
-- enumeration surface.

revoke execute on function public.is_email_banned(text) from anon;
revoke execute on function public.is_email_banned(text) from authenticated;
revoke execute on function public.is_phone_banned(text) from anon;
revoke execute on function public.is_phone_banned(text) from authenticated;

comment on function public.is_email_banned(text) is
  'Service-role only. Callable from trusted server code (the sign-up gate); never granted to anon or authenticated, or it becomes an oracle for who is banned.';
comment on function public.is_phone_banned(text) is
  'Service-role only. Callable from trusted server code (sign-up and the account phone check); never granted to anon or authenticated.';
