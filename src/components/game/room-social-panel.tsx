"use client";

import { useState } from "react";
import { AlertTriangle, Copy, MessageCircle, Radio, Send, UserCheck, UsersRound } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import type { GardenChatMessage } from "@/lib/game/chat-moderation";
import type { RealtimeRoomPlayer } from "@/lib/game/types";

type RoomSocialPanelProps = {
  approvedDecoratorCodes?: string[];
  canManagePlacement?: boolean;
  connectionState: string;
  inviteUrl: string;
  messages: GardenChatMessage[];
  onToggleDecorator?: (friendCode: string) => void;
  players: RealtimeRoomPlayer[];
  roomCode: string;
  sendChat: (input: string) => { ok: true; text: string } | { ok: false; reason: string };
  status: string;
};

export function RoomSocialPanel({
  approvedDecoratorCodes = [],
  canManagePlacement = true,
  connectionState,
  inviteUrl,
  messages,
  onToggleDecorator,
  players,
  roomCode,
  sendChat,
  status,
}: RoomSocialPanelProps) {
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("Room chat is moderated and rate-limited.");
  const decorators = new Set(approvedDecoratorCodes);
  const approvablePlayers = players.filter((player) => Boolean(player.friendCode));

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice("Room invite copied. Decorator access is granted here by the host.");
    } catch {
      setNotice(inviteUrl);
    }
  }

  function markTyping(isTyping: boolean) {
    window.dispatchEvent(new CustomEvent("hearthaven:text-input-focus", { detail: isTyping }));
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

  function toggleDecorator(friendCode?: string) {
    if (!friendCode) return;
    if (!canManagePlacement) {
      setNotice("Only the host can change room decorator permissions.");
      return;
    }
    onToggleDecorator?.(friendCode);
    setNotice(
      decorators.has(friendCode)
        ? "Decorator access removed for that visitor."
        : "Decorator access granted to that visitor only.",
    );
  }

  return (
    <CozyCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-lavender-500">
            <Radio className="size-3.5" /> Room {roomCode}
          </p>
          <h2 className="mt-1 font-display text-2xl text-ink-900">Friends and chat</h2>
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
        <Badge variant="garden">{players.length} visiting</Badge>
      </div>

      <div className="mt-3 rounded-lg border border-honey-500/30 bg-honey-100/70 p-3 text-xs font-bold leading-5 text-ink-700">
        <AlertTriangle className="mr-1 inline size-3.5 text-honey-700" />
        Furniture editing is host-selected per visitor. Approved decorators can drag, face, and depth-layer furniture.
      </div>

      <div className="mt-3 rounded-lg border border-lavender-300/50 bg-lavender-100/60 p-3">
        <p className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-lavender-600">
          <UserCheck className="size-3.5" /> Decorators
        </p>
        {canManagePlacement ? (
          approvablePlayers.length === 0 ? (
            <p className="text-xs font-bold leading-5 text-ink-600">
              Invite a friend first, then approve exactly who can decorate.
            </p>
          ) : (
            <div className="grid gap-2">
              {approvablePlayers.map((player) => (
                <div
                  className="flex items-center justify-between gap-2 rounded-md border border-white/70 bg-white/70 px-2 py-1.5"
                  key={`${player.id}-${player.friendCode}`}
                >
                  <span className="min-w-0 truncate text-xs font-black text-ink-800">@{player.displayName}</span>
                  <CozyButton
                    onClick={() => toggleDecorator(player.friendCode)}
                    size="sm"
                    variant={player.friendCode && decorators.has(player.friendCode) ? "default" : "secondary"}
                  >
                    {player.friendCode && decorators.has(player.friendCode) ? "Remove" : "Allow"}
                  </CozyButton>
                </div>
              ))}
            </div>
          )
        ) : (
          <p className="text-xs font-bold leading-5 text-ink-600">Ask the host for decorator access.</p>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-blush-300/40 bg-blush-100/50 p-3">
        <p className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-500">
          <MessageCircle className="size-3.5" /> Room chat
        </p>
        <div className="flex gap-2">
          <input
            aria-label="Write a room chat message"
            className="min-w-0 flex-1 rounded-full border border-cream-300 bg-white/80 px-3 py-2 text-sm font-bold text-ink-800 outline-none transition focus:border-blush-300 focus:ring-2 focus:ring-blush-200"
            maxLength={160}
            onBlur={() => markTyping(false)}
            onChange={(event) => setInput(event.target.value)}
            onFocus={() => markTyping(true)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") submitMessage();
            }}
            onKeyUp={(event) => event.stopPropagation()}
            placeholder="Say something cozy..."
            value={input}
          />
          <CozyButton onClick={submitMessage} size="sm">
            <Send />
          </CozyButton>
        </div>
        <p className="mt-2 text-xs font-bold text-ink-600">{notice}</p>
      </div>

      <div className="mt-4 grid max-h-52 gap-2 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-cream-300 bg-white/70 p-3 text-sm font-bold text-ink-600">
            No room messages yet. Invite a friend or write the first note.
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="rounded-lg border border-cream-300 bg-white/75 p-3 shadow-sm">
              <p className="text-xs font-extrabold uppercase tracking-normal text-blush-500">@{message.displayName}</p>
              <p className="mt-1 text-sm font-bold leading-5 text-ink-800">{message.text}</p>
            </div>
          ))
        )}
      </div>
    </CozyCard>
  );
}
