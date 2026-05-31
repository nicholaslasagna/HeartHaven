"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ClipboardCheck,
  Copy,
  MessageCircle,
  Radio,
  Send,
  UserCheck,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import type { GardenChatMessage } from "@/lib/game/chat-moderation";
import type { RealtimeRoomPlayer } from "@/lib/game/types";
import { getSocialState, SOCIAL_EVENT, type Friend } from "@/lib/game/social";
import { useSocial } from "@/lib/game/use-social";

type GardenSocialPanelProps = {
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

export function GardenSocialPanel({
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
}: GardenSocialPanelProps) {
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("Chat is moderated: no links, phone numbers, email addresses, or harmful messages.");
  const [copiedFriendCode, setCopiedFriendCode] = useState<string | null>(null);
  const social = useSocial();
  // The host's PUBLIC friend code — the thing visitors should actually
  // share to add the host. `roomCode` is the scene slug (e.g.
  // "HONEYHEART-PARK") which is useless for friending. Pulled from the
  // social state and kept in sync via the SOCIAL_EVENT channel.
  const [hostFriendCode, setHostFriendCode] = useState("HH-XXXXX-XXX");
  useEffect(() => {
    const sync = () => setHostFriendCode(getSocialState().selfCode || "HH-XXXXX-XXX");
    sync();
    window.addEventListener(SOCIAL_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SOCIAL_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const decorators = new Set(approvedDecoratorCodes);
  const approvablePlayers = players.filter((player) => Boolean(player.friendCode));

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice("Garden invite copied. Decorator access is approved here by the host.");
    } catch {
      setNotice(inviteUrl);
    }
  }

  async function inviteFriend(friend: Friend) {
    const share = navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };

    if (share.share) {
      try {
        await share.share({
          title: "HeartHaven garden invite",
          text: `${friend.displayName}, come visit my HeartHaven garden.`,
          url: inviteUrl,
        });
        setNotice(`Invite ready for ${friend.displayName}.`);
        return;
      } catch {
        // Fall back to clipboard copy if the system share sheet is cancelled.
      }
    }

    try {
      await navigator.clipboard.writeText(`Come visit my HeartHaven garden: ${inviteUrl}`);
      setCopiedFriendCode(friend.code);
      window.setTimeout(() => setCopiedFriendCode((current) => (current === friend.code ? null : current)), 1400);
      setNotice(`Garden visit link copied for ${friend.displayName}.`);
    } catch {
      setNotice(inviteUrl);
    }
  }

  function submitMessage() {
    const result = sendChat(input);
    // Only fire the speech cue when the message ACTUALLY broadcasts.
    // Firing on soft-block / hard-block / rate-limit rejections was
    // confusing — the user got a "ping" for a message that never sent.
    if (result.ok) {
      window.dispatchEvent(new CustomEvent("hearthaven:chat-spoke"));
    }
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
      setNotice("Only the host can change garden placement permissions.");
      return;
    }
    onToggleDecorator?.(friendCode);
    setNotice(
      decorators.has(friendCode)
        ? "Decorator access removed for that visitor."
        : "Decorator access granted to that visitor only.",
    );
  }

  function markTyping(isTyping: boolean) {
    window.dispatchEvent(new CustomEvent("hearthaven:text-input-focus", { detail: isTyping }));
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* The "Invite" used to copy a long URL. Now it shows the host's
            friend code — the same handle everywhere else in HeartHaven —
            and tucks the visit URL behind a less-prominent button for the
            rare case someone actually wants the deep link. */}
        <button
          aria-label={`Copy your friend code ${hostFriendCode}`}
          className="inline-flex items-center gap-2 rounded-full border border-cream-300 bg-white/90 px-3 py-1 text-xs font-extrabold text-ink-800 shadow-sm transition hover:-translate-y-0.5 hover:border-blush-300 hover:bg-blush-100"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(hostFriendCode);
              setNotice(`Copied ${hostFriendCode}. Send it to a friend so they can add you on the Friends page.`);
            } catch {
              setNotice(hostFriendCode);
            }
          }}
          type="button"
        >
          <Copy className="size-3.5" /> Share code
          <span className="font-mono text-[11px] text-ink-600">{hostFriendCode}</span>
        </button>
        <button
          aria-label="Copy visit URL"
          className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white/70 px-3 py-1 text-[11px] font-extrabold text-ink-600 transition hover:bg-cream-200"
          onClick={copyInvite}
          type="button"
        >
          Visit link
        </button>
        <Badge variant="garden">{players.length} visiting</Badge>
      </div>

      <div className="mt-3 rounded-lg border border-honey-500/30 bg-honey-100/70 p-3 text-xs font-bold leading-5 text-ink-700">
        <AlertTriangle className="mr-1 inline size-3.5 text-honey-700" />
        Decorator access is host-selected per visitor. Approved guests can move, face, and place host-approved objects in
        this lobby only.
      </div>

      <div className="mt-3 rounded-lg border border-blush-300/45 bg-blush-100/50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-600">
            <UserPlus className="size-3.5" /> Invite friends
          </p>
          <Badge variant="outline">{social.friends.length}</Badge>
        </div>
        {social.friends.length === 0 ? (
          <p className="text-xs font-bold leading-5 text-ink-600">
            Add friends first, then they&apos;ll appear here for one-tap garden invites.
          </p>
        ) : (
          <div className="grid max-h-48 gap-2 overflow-y-auto pr-1">
            {social.friends.map((friend) => (
              <div
                className="flex items-center justify-between gap-2 rounded-md border border-white/70 bg-white/78 px-2.5 py-2"
                key={friend.code}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-ink-900">{friend.displayName}</p>
                  <p className="font-mono text-[11px] font-bold text-ink-500">{friend.code}</p>
                </div>
                <CozyButton
                  onClick={() => void inviteFriend(friend)}
                  size="sm"
                  variant={copiedFriendCode === friend.code ? "warm" : "secondary"}
                >
                  {copiedFriendCode === friend.code ? <ClipboardCheck /> : <UserPlus />}
                  {copiedFriendCode === friend.code ? "Copied" : "Invite"}
                </CozyButton>
              </div>
            ))}
          </div>
        )}
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
          <p className="text-xs font-bold leading-5 text-ink-600">
            Decorator access is managed by the host for specific visitors.
          </p>
        )}
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
