import { notFound } from "next/navigation";
import { BowlingPreview } from "./bowling-preview";

/**
 * Development-only harness for Moonberry Bowling.
 *
 * The real route lives behind the app's sign-in gate, which makes the alley
 * impossible to look at while building it. This renders the same canvas with
 * a local throw log and no session, so the scene can be inspected and
 * screenshotted. It 404s outside development so it can never ship.
 */
export default function BowlingPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <BowlingPreview />;
}
