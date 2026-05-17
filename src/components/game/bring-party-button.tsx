"use client";

import { useState } from "react";
import { Sparkles, Users2 } from "lucide-react";
import { broadcastPartyRelocate } from "@/lib/game/party-bridge";

type BringPartyButtonProps = {
  /** Destination path the host wants their party to follow them to. */
  path: string;
  /** Friendly label shown to followers ("your room", "the bowling lane"). */
  label?: string;
  /** Optional extra styling override (uses sensible defaults otherwise). */
  className?: string;
  /** Compact look — small chip variant for narrow layouts. */
  compact?: boolean;
};

/**
 * "Bring my party here" — single-tap host action that fires a relocate
 * event over the host's friend-code channel. Every friend subscribed to
 * the host's channel (via `PartyFollowToast`) immediately sees a follow
 * prompt without needing a fresh invite.
 *
 * Idempotent on click — disables itself for a couple of seconds after
 * sending so a rage-tap doesn't blast the channel.
 */
export function BringPartyButton({ path, label, className, compact = false }: BringPartyButtonProps) {
  const [sending, setSending] = useState(false);
  const [sentLabel, setSentLabel] = useState<string | null>(null);

  async function send() {
    if (sending) return;
    setSending(true);
    const result = await broadcastPartyRelocate({ path, label });
    setSending(false);
    if (result.ok) {
      setSentLabel(`Your party was nudged toward ${label ?? "the new area"}.`);
      window.setTimeout(() => setSentLabel(null), 4_000);
    }
  }

  const base = compact
    ? "inline-flex items-center gap-1.5 rounded-full border border-blush-300/60 bg-blush-100/80 px-3 py-1.5 text-xs font-extrabold text-blush-700 transition hover:-translate-y-0.5 hover:bg-blush-100 disabled:opacity-60"
    : "inline-flex items-center gap-2 rounded-full border border-blush-300/60 bg-gradient-to-r from-blush-200 to-blush-300 px-4 py-2 text-sm font-extrabold text-cream-50 shadow-sm transition hover:-translate-y-0.5 disabled:opacity-60";

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        aria-label="Bring everyone in your party to this area"
        className={`${base} ${className ?? ""}`}
        disabled={sending}
        onClick={send}
        type="button"
      >
        {sending ? <Sparkles className="size-3.5" /> : <Users2 className={compact ? "size-3.5" : "size-4"} />}
        {sending ? "Sending…" : "Bring my party"}
      </button>
      {sentLabel && (
        <span className="rounded-full bg-cream-50/90 px-2 py-0.5 text-[10px] font-extrabold text-garden-700 shadow-sm">
          {sentLabel}
        </span>
      )}
    </span>
  );
}
