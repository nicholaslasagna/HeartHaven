-- Tighten room session visibility before real invite-code persistence is wired into the app.

drop policy if exists "Room sessions are readable by players" on public.room_sessions;

create policy "Room sessions visible to hosts and members"
on public.room_sessions for select to authenticated
using (
  auth.uid() = host_id
  or exists (
    select 1
    from public.room_session_members rsm
    where rsm.session_id = room_sessions.id
      and rsm.profile_id = auth.uid()
  )
);

create policy "Room session members can view each other"
on public.room_session_members for select to authenticated
using (
  auth.uid() = profile_id
  or exists (
    select 1
    from public.room_session_members mine
    where mine.session_id = room_session_members.session_id
      and mine.profile_id = auth.uid()
  )
);
