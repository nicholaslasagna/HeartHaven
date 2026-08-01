import { redirect } from "next/navigation";

/**
 * Bowling now lives at /app/moonberry-bowling. Kept as a redirect so links
 * and bookmarks from before the 3D rebuild still land somewhere sensible.
 */
export default async function BowlingPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;
  const target = session
    ? `/app/moonberry-bowling?session=${encodeURIComponent(session)}`
    : "/app/moonberry-bowling";
  redirect(target);
}
