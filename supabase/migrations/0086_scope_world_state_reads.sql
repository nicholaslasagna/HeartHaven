-- 0086_scope_world_state_reads.sql
--
-- Six world-state tables were readable in full by any signed-in player.
--
-- THE ISSUE. 0024 and 0035 gave these tables a SELECT policy of
-- `using (true)`:
--
--     room_placements_state     garden_decor_state
--     room_surfaces_state       garden_plots_state
--     room_decorator_grants     garden_decorator_grants
--
-- The reasoning recorded in 0024 was that each table is "keyed on
-- profile_id (an opaque UUID), so a guest can't browse the table to
-- discover other hosts". That defends against GUESSING a particular key.
-- It does nothing against enumeration: `using (true)` means an authenticated
-- caller can ask for the table with no filter at all and receive every row.
-- Through PostgREST that is a single unfiltered GET.
--
-- What that exposed: every player's room layout, garden decor, planted
-- plots and wall/floor choices, plus both decorator-grant tables — which
-- carry `grantee_friend_code`, the code the whole invite system is keyed on.
--
-- THE FIX. Scope each policy to the owning host. This costs the app
-- nothing, because nothing was relying on the permissive read:
--
--   * No client code reads these tables directly. Every path goes through
--     get_room_placements / get_garden_decor / get_room_surfaces /
--     get_garden_plots and their save_* counterparts, all of which are
--     SECURITY DEFINER and therefore bypass RLS entirely. A guest visiting
--     with a host's friend code still resolves through those functions,
--     exactly as before.
--   * None of the six is subscribed via postgres_changes, so no Realtime
--     delivery depends on the policy. Garden and room sync run over
--     broadcast channels.
--
-- The `deny direct ... writes` policies from 0035 are left untouched: writes
-- were already funnelled through the save_* functions.

-- Rooms.
drop policy if exists "authenticated read room placements" on public.room_placements_state;
create policy "hosts read their own room placements"
  on public.room_placements_state for select to authenticated
  using (auth.uid() = host_profile_id);

drop policy if exists "authenticated read room surfaces" on public.room_surfaces_state;
create policy "hosts read their own room surfaces"
  on public.room_surfaces_state for select to authenticated
  using (auth.uid() = host_profile_id);

drop policy if exists "authenticated read room grants" on public.room_decorator_grants;
create policy "hosts read their own room grants"
  on public.room_decorator_grants for select to authenticated
  using (auth.uid() = host_profile_id);

-- Gardens.
drop policy if exists "authenticated read garden decor" on public.garden_decor_state;
create policy "hosts read their own garden decor"
  on public.garden_decor_state for select to authenticated
  using (auth.uid() = host_profile_id);

drop policy if exists "authenticated read garden plots" on public.garden_plots_state;
create policy "hosts read their own garden plots"
  on public.garden_plots_state for select to authenticated
  using (auth.uid() = host_profile_id);

drop policy if exists "authenticated read garden grants" on public.garden_decorator_grants;
create policy "hosts read their own garden grants"
  on public.garden_decorator_grants for select to authenticated
  using (auth.uid() = host_profile_id);
