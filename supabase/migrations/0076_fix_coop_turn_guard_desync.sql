-- 0076_fix_coop_turn_guard_desync.sql
--
-- BUG: Firefly Grove (and the other co-op party games) became unplayable —
-- every action came back "not your turn" for every player.
--
-- ROOT CAUSE: the 0074 guard recomputed the expected seat by replaying the
-- whole `coop-action` log, but its replay did NOT apply the same filters
-- the client reducer applies (`co-op-party-games.ts`):
--
--   client: skips moves whose payload.gameKey != the current game
--           stops advancing once the round is over
--   0074  : counted EVERY coop-action row in the session
--
-- So the moment a session hosted more than one co-op game — or replayed a
-- round — the server's expected seat drifted from the client's. The UI
-- enabled the button for the seat it believed was active, the trigger
-- rejected that exact seat, and the game deadlocked for everyone.
--
-- FIX: stop recomputing a global turn order. The trigger now enforces a
-- single invariant that cannot drift: *you may not take two co-op turns in
-- a row*. That is the abuse worth blocking (a client spamming its own
-- actions), and it needs no replay, so there is nothing to desync.
--
-- Strictness we deliberately give up, and why it costs nothing: with 3+
-- players this no longer rejects "player A acted when it was C's turn".
-- It does not matter — `submit_game_move` already derives seat_index from
-- auth.uid() (so nobody can act AS someone else), and the client reducer
-- already ignores any wrong-seat row when it computes state
-- (`if (move.seat_index !== currentSeat) continue`). Game state was never
-- reachable from an out-of-turn row; the guard only ever protected log
-- tidiness. A guard that blocks legitimate play is strictly worse than a
-- narrower guard that works.

create or replace function public.enforce_coop_party_turn_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_key text;
  v_move_game_key text;
  v_seat_count integer := 1;
  v_last_seat integer;
begin
  if new.move_type <> 'coop-action' then
    return new;
  end if;

  select coalesce(nullif(trim(session_row.selected_game_key), ''), session_row.game_key)
    into v_game_key
  from public.game_sessions as session_row
  where session_row.id = new.session_id;

  if v_game_key is null then
    return new;
  end if;

  if v_game_key like '%-party' then
    v_game_key := left(v_game_key, length(v_game_key) - 6);
  end if;

  if v_game_key not in ('moonbeam-bakeoff', 'firefly-grove', 'moonlight-melody') then
    return new;
  end if;

  -- Solo sessions have no turn order to violate.
  select greatest(1, count(*)::integer)
    into v_seat_count
  from public.game_session_players as seated_player
  where seated_player.session_id = new.session_id;

  if v_seat_count <= 1 then
    return new;
  end if;

  -- Compare against the previous action for THIS game only. Scoping by the
  -- payload's gameKey mirrors the client reducer, so a session that hosted
  -- a different co-op game earlier cannot poison this check.
  v_move_game_key := coalesce(new.payload->>'gameKey', v_game_key);

  select previous_move.seat_index
    into v_last_seat
  from public.game_moves as previous_move
  where previous_move.session_id = new.session_id
    and previous_move.move_type = 'coop-action'
    and coalesce(previous_move.payload->>'gameKey', v_move_game_key) = v_move_game_key
  order by previous_move.move_index desc
  limit 1;

  if v_last_seat is not null and v_last_seat is not distinct from new.seat_index then
    raise exception 'not your turn'
      using errcode = 'P0001',
            detail = format(
              'seat %s already played the last %s action in session %s',
              new.seat_index,
              v_move_game_key,
              new.session_id
            );
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_coop_party_turn_before_insert on public.game_moves;

create trigger enforce_coop_party_turn_before_insert
before insert on public.game_moves
for each row
execute function public.enforce_coop_party_turn_trigger();

revoke all on function public.enforce_coop_party_turn_trigger() from public;
grant execute on function public.enforce_coop_party_turn_trigger() to service_role;
