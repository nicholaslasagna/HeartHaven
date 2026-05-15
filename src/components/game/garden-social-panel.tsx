"use client";

import { useState } from "react";
import { AlertTriangle, Copy, MessageCircle, Radio, Send, UsersRound, Wrench } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import type { GardenChatMessage } from "@/lib/game/chat-moderation";
import type { RealtimeRoomPlayer } from "@/lib/game/types";

type GardenSocialPanelProps = {
  canManagePlacement?: boolean;
  connectionState: string;
  guestPlacementEnabled: boolean;
  inviteUrl: string;
  messages: GardenChatMessage[];
  onGuestPlacementChange?: (enabled: boolean) => void;
  players: RealtimeRoomPlayer[];
  roomCode: string;
  sendChat: (input: string) => { ok: true; text: string } | { ok: false; reason: string };
  status: string;
};

export function GardenSocialPanel({
  canManagePlacement = true,
  connectionState,
  guestPlacementEnabled,
  inviteUrl,
  messages,
  onGuestPlacementChange,
  players,
  roomCode,
  sendChat,
  status,
}: GardenSocialPanelProps) {
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("Chat is moderated: no links, phone numbers, email addresses, or harmful messages.");

  async function copyInvite() {
    try {
      const url = new URL(inviteUrl, window.location.origin);
      if (guestPlacementEnabled) url.searchParams.set("decorator", "1");
      await navigator.clipboard.writeText(url.toString());
      setNotice(guestPlacementEnabled ? "Decorator invite copied." : "Garden invite copied.");
    } catch {
      setNotice(inviteUrl);
    }
  }

  function submitMessage() {
    const result = sendChat(input);
    if (!result.ok) {
      setNotice(result.reason);
      return;
    }
    setInput("");
    setNotice("Message sent.");
  }

  function toggleGuestPlacement() {
    if (!canManagePlacement) {
      setNotice("Only the host can change garden placement permissions.");
      return;
    }
    const next = !guestPlacementEnabled;
    onGuestPlacementChange?.(next);
    setNotice(
      next
        ? "Guest placement enabled. Only grant this to trusted visitors because they can move, rotate, and place host-approved objects."
        : "Guest placement disabled. Only the host can place or move world objects.",
    );
  }

  return (
    <CozyCard className="flex min-h-full flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-garden-700">
            <Radio className="size-3.5" /> Garden visit {roomCode}
          </p>
          <h2 className="mt-1 font-display text-2xl text-ink-900">Visitors and chat</h2>
          <p className="mt-1 text-xs font-bold text-ink-600">{status}</p>
        </div>
        <Badge variant="outline">
          <UsersRound className="size-3.5" /> {connectionState}
        </Badge>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <CozyButton onClick={copyInvite} size="sm" variant="warm">
          <Copy /> Invite
        </CozyButton>
        <CozyButton
          disabled={!canManagePlacement}
          onClick={toggleGuestPlacement}
          size="sm"
          variant={guestPlacementEnabled ? "default" : "secondary"}
        >
          <Wrench /> {guestPlacementEnabled ? "Guests can place" : "Host places"}
        </CozyButton>
        <Badge variant="garden">{players.length} visiting</Badge>
      </div>

      <div className="mt-3 rounded-lg border border-honey-500/30 bg-honey-100/70 p-3 text-xs font-bold leading-5 text-ink-700">
        <AlertTriangle className="mr-1 inline size-3.5 text-honey-700" />
        Placement permissions should only be shared with trusted guests. Guests with access can move, rotate, and place
        host-approved objects in the current lobby.
      </div>

      <div className="mt-4 rounded-lg border border-garden-300/50 bg-garden-100/55 p-3">
        <p className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-garden-700">
          <MessageCircle className="size-3.5" /> Garden chat
        </p>
        <div className="flex gap-2">
          <input
            aria-label="Write a garden chat message"
            className="min-w-0 flex-1 rounded-full border border-cream-300 bg-white/80 px-3 py-2 text-sm font-bold text-ink-800 outline-none transition focus:border-blush-300 focus:ring-2 focus:ring-blush-200"
            maxLength={160}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitMessage();
            }}
            placeholder="Say something cozy..."
            value={input}
          />
          <CozyButton onClick={submitMessage} size="sm">
            <Send />
          </CozyButton>
        </div>
        <p className="mt-2 text-xs font-bold text-ink-600">{notice}</p>
      </div>

      <div className="mt-4 grid max-h-80 gap-2 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-cream-300 bg-white/70 p-3 text-sm font-bold text-ink-600">
            No messages yet. Invite a friend or write the first garden note.
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="rounded-lg border border-cream-300 bg-white/75 p-3 shadow-sm">
              <p className="text-xs font-extrabold uppercase tracking-normal text-blush-500">{message.displayName}</p>
              <p className="mt-1 text-sm font-bold leading-5 text-ink-800">{message.text}</p>
            </div>
          ))
        )}
      </div>
    </CozyCard>
  );
}
