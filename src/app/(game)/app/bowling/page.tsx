import { redirect } from "next/navigation";

/**
 * Bowling now lives at /app/moonberry-bowling. Kept as a redirect so links
 * and bookmarks from before the 3D rebuild still land somewhere sensible.
 */
export default function BowlingPage() {
  redirect("/app/moonberry-bowling");
}
