-- 0074_coop_party_turn_guard.sql
--
-- The newer co-op party games use the generic append-only
-- submit_game_move path. The React UI already disables buttons unless
-- the local player is the active seat, and the reducer ignores stale
-- wrong-seat rows, but direct RPC calls could still append an
-- out-of-turn `coop-action` row. That makes the server log less strict
-- than the client state.
--
-- This trigger hardens the shared log without redesigning the games:
-- for the three co-op party games, every inserted `coop-action` must
-- come from the expected active seat. The expected seat is derived by
-- replaying existing valid co-op moves in move_index order. Historical
-- wrong-seat rows, if any, are ignored by the replay just like the
-- client reducer already ignores them.

create or replace function public.enforce_coop_party_turn_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_key text;
  v_seat_count integer := 1;
  v_expected_seat integer := 0;
  v_existing record;
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

  select greatest(1, count(*)::integer)
    into v_seat_count
  from public.game_session_players as seated_player
  where seated_player.session_id = new.session_id;

  for v_existing in
    select logged_move.seat_index
    from public.game_moves as logged_move
    where logged_move.session_id = new.session_id
      and logged_move.move_type = 'coop-action'
    order by logged_move.move_index asc
  loop
    if v_existing.seat_index is not distinct from v_expected_seat then
      v_expected_seat := (v_expected_seat + 1) % v_seat_count;
    end if;
  end loop;

  if new.seat_index is distinct from v_expected_seat then
    raise exception 'not your turn'
      using errcode = 'P0001',
            detail = format(
              'expected seat %s for %s session %s, got seat %s',
              v_expected_seat,
              v_game_key,
              new.session_id,
              new.seat_index
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
