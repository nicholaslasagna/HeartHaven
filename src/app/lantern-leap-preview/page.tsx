import { notFound } from "next/navigation";
import { LanternLeapPreview } from "./preview-client";

/**
 * Development-only harness for Lantern Leap.
 *
 * It exists so the game can be looked at and played without going through
 * sign-in — the app's own `/app/*` routes are gated, which makes visual
 * review impossible. Never reachable in a production build.
 */
export const dynamic = "force-dynamic";

export default function LanternLeapPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LanternLeapPreview />;
}
