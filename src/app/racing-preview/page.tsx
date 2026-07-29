import { notFound } from "next/navigation";
import { RacingPreview } from "./racing-preview";

/**
 * Development-only harness for Moonberry Racing.
 *
 * The real route sits behind the app's sign-in gate, which makes the courses
 * impossible to look at while building them. This mounts the same canvas
 * with local seats and no session. It 404s outside development so it can
 * never ship.
 */
export default function RacingPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <RacingPreview />;
}
