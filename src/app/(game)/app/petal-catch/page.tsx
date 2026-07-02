import { PetalCatchClient } from "@/app/(game)/app/petal-catch/petal-catch-client";

export default async function PetalCatchPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;
  return <PetalCatchClient sessionId={session ?? null} />;
}
