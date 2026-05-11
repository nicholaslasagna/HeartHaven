import { PartnerGardenClient } from "@/app/(game)/app/partner-garden/partner-garden-client";
import { friendInvite, partnerGardenPlots } from "@/lib/mock-data";

export default function PartnerGardenPage() {
  return <PartnerGardenClient invite={friendInvite} plots={partnerGardenPlots} />;
}
