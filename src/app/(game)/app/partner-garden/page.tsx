import { Suspense } from "react";
import { PartnerGardenClient } from "@/app/(game)/app/partner-garden/partner-garden-client";
import { friendInvite, partnerGardenPlots } from "@/lib/mock-data";

export default function PartnerGardenPage() {
  return (
    <Suspense fallback={<div className="rounded-lg border border-blush-300/40 bg-blush-100/55 p-5 text-sm font-extrabold text-ink-700">Opening the shared garden...</div>}>
      <PartnerGardenClient invite={friendInvite} plots={partnerGardenPlots} />
    </Suspense>
  );
}
