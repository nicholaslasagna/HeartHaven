"use client";

import { Sparkles } from "lucide-react";

const NUDGES = [
  '"There\'s a glow by the conservatory — send your companion through the cherry-tree gap."',
  '"Picnic blanket spotted near the fountain. Bring a friend to share strawberries."',
  '"Lantern arch is lit tonight — perfect for slow walks and quiet chats."',
  '"The claw machine eats coins. Your companion still cheers either way."',
];

function pickNudge(): string {
  const minute = Math.floor(Date.now() / (1000 * 60));
  return NUDGES[minute % NUDGES.length];
}

/**
 * A small "what should we do next" card. Quietly rotates copy so the park
 * always has a fresh thing to suggest, without us actually changing state.
 */
export function ParkCoOpNudge() {
  const nudge = pickNudge();
  return (
    <section
      className="hh-card relative overflow-hidden p-4"
      style={{ background: "linear-gradient(135deg, rgba(251,227,227,0.92), rgba(239,230,247,0.92))" }}
    >
      <p className="hh-eyebrow text-blush-500 flex items-center gap-1">
        <Sparkles className="size-3" /> Co-op nudge
      </p>
      <p className="hh-serif mt-1 text-sm italic leading-5 text-ink-800">{nudge}</p>
      <button className="hh-btn hh-btn-primary mt-3 text-xs">Send companion</button>
    </section>
  );
}
