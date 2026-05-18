import { redirect } from "next/navigation";

/**
 * Standalone `/app/garden` route — kept for back-compat. All zone
 * navigation now flows through the seamless `/app/area` container.
 * Forwards `?garden=` and `?visit=` query params so invite links still
 * resolve the right host's garden.
 */
export default async function GardenPage({
  searchParams,
}: {
  searchParams: Promise<{ garden?: string; visit?: string }>;
}) {
  const { garden, visit } = await searchParams;
  const params = new URLSearchParams({ zone: "garden" });
  if (garden) params.set("garden", garden);
  if (visit) params.set("visit", visit);
  redirect(`/app/area?${params.toString()}`);
}
