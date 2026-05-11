"use client";

import { useState } from "react";
import { Check, Copy, UsersRound } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";

type FriendInviteCardProps = {
  title: string;
  description: string;
  code: string;
};

export function FriendInviteCard({ title, description, code }: FriendInviteCardProps) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <CozyCard className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-11 place-items-center rounded-lg bg-blush-100 text-blush-500">
          <UsersRound className="size-5" />
        </div>
        <div>
          <h2 className="font-display text-2xl text-ink-900">{title}</h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-ink-700">{description}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-cream-300 bg-cream-50 p-3">
        <code className="font-mono text-sm font-bold text-ink-900">{code}</code>
        <CozyButton size="sm" variant="warm" onClick={copyCode}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </CozyButton>
      </div>
    </CozyCard>
  );
}
