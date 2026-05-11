import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";

export function RoomPreview() {
  return (
    <CozyCard className="overflow-hidden">
      <div className="relative h-48 bg-cream-100">
        <div className="absolute inset-x-8 bottom-4 h-24 rounded-lg border-2 border-cream-300 bg-cream-200" />
        <div className="absolute left-12 top-8 h-20 w-24 rounded-md border-4 border-ink-500/50 bg-sky-200" />
        <div className="absolute bottom-8 left-1/2 h-16 w-36 -translate-x-1/2 rounded-[50%] border-2 border-blush-300 bg-blush-200" />
        <div className="absolute bottom-10 right-16 h-14 w-9 rounded-md border-4 border-ink-500/55 bg-honey-100" />
        <div className="absolute bottom-10 left-20 h-16 w-20 rounded-md border-2 border-lavender-500/40 bg-lavender-200" />
      </div>
      <div className="p-5">
        <h2 className="font-display text-3xl text-ink-900">Moonlit Loft</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-ink-700">
          A small starter room with furniture placeholders, a pet companion, and a Phaser movement loop.
        </p>
        <CozyButton asChild className="mt-4">
          <Link href="/app/room">
            Open room <ArrowRight />
          </Link>
        </CozyButton>
      </div>
    </CozyCard>
  );
}
