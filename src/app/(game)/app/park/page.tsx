import { redirect } from "next/navigation";

/**
 * Standalone `/app/park` route — kept for back-compat. All zone
 * navigation now flows through the seamless `/app/area` container.
 * Forwards `?visit=` so invite links still resolve the right host.
 */
export default async function ParkPage({
  searchParams,
}: {
  searchParams: Promise<{ visit?: string }>;
}) {
  const { visit } = await searchParams;
  const params = new URLSearchParams({ zone: "park" });
  if (visit) params.set("visit", visit);
  redirect(`/app/area?${params.toString()}`);
}
