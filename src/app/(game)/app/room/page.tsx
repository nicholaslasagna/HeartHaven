import { redirect } from "next/navigation";

/**
 * Standalone `/app/room` route — kept for back-compat with existing
 * bookmarks + invite links. All zone navigation now flows through the
 * seamless `/app/area` container so switching between room / garden /
 * park doesn't unmount the shell, audio, and realtime channels.
 *
 * Forwards `?room=` and `?visit=` query params so invite links keep
 * resolving the right host's room.
 */
export default async function RoomPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; visit?: string }>;
}) {
  const { room, visit } = await searchParams;
  const params = new URLSearchParams({ zone: "room" });
  if (room) params.set("room", room);
  if (visit) params.set("visit", visit);
  redirect(`/app/area?${params.toString()}`);
}
