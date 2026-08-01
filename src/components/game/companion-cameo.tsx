"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  COMPANION_ROSTER_EVENT,
  getActiveCompanion,
  type CompanionRecord,
} from "@/lib/game/companion-roster";
import { companionArtAsset } from "@/lib/game/companion-art";
import { cn } from "@/lib/utils";

type CompanionCameoProps = {
  className?: string;
  copy?: string;
};

/** Keeps the selected companion present in arcade spaces without coupling it to a game renderer. */
export function CompanionCameo({ className, copy = "is cheering" }: CompanionCameoProps) {
  const [companion, setCompanion] = useState<CompanionRecord | null>(null);

  useEffect(() => {
    const sync = () => setCompanion(getActiveCompanion() ?? null);
    sync();
    window.addEventListener(COMPANION_ROSTER_EVENT, sync);
    return () => window.removeEventListener(COMPANION_ROSTER_EVENT, sync);
  }, []);

  const name = companion?.name ?? "Casper";
  const art = companionArtAsset(companion?.speciesId);

  return (
    <div
      className={cn(
        "inline-flex min-w-0 items-center gap-2 rounded-md border border-white/80 bg-white/70 px-2.5 py-1.5 shadow-sm",
        className,
      )}
      title={`${name} ${copy}`}
    >
      <span className="relative size-9 shrink-0 overflow-hidden rounded-full bg-white/85">
        <Image alt="" className="object-contain" fill sizes="36px" src={art} />
      </span>
      <span className="max-w-32 truncate text-xs font-extrabold text-ink-700">
        {name} {copy}
      </span>
    </div>
  );
}
