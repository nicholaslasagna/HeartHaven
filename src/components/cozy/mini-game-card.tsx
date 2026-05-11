import { Gamepad2, Gift } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";

type MiniGameCardProps = {
  title: string;
  description: string;
  reward: string;
  status: string;
};

export function MiniGameCard({ title, description, reward, status }: MiniGameCardProps) {
  return (
    <CozyCard className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="grid size-11 place-items-center rounded-lg bg-lavender-100 text-lavender-500">
          <Gamepad2 className="size-5" />
        </div>
        <Badge variant="outline">{status}</Badge>
      </div>
      <h2 className="font-display text-2xl text-ink-900">{title}</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-ink-700">{description}</p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-honey-700">
          <Gift className="size-4" />
          {reward}
        </span>
        <CozyButton size="sm" variant="warm">Preview</CozyButton>
      </div>
    </CozyCard>
  );
}
