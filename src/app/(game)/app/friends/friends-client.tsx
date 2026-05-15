"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Ban,
  ClipboardCheck,
  Copy,
  Flag,
  Gift,
  Inbox,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { GiftDialog } from "@/components/cozy/gift-dialog";
import { ReportDialog } from "@/components/cozy/report-dialog";
import { Badge } from "@/components/ui/badge";
import { useSocial } from "@/lib/game/use-social";
import { useSafety } from "@/lib/game/use-safety";
import { useInventory } from "@/lib/game/use-inventory";
import { isFriendCodeShape, normalizeFriendCode } from "@/lib/game/social";
import type { FriendCode } from "@/lib/game/social";
import { getCachedPublicUsername } from "@/lib/game/public-identity";
import { cn } from "@/lib/utils";

/**
 * FriendsClient — the social hub. Friend code + invite-by-code lookup (gated:
 * only people you've already played with can be looked up), invite inbox,
 * friend list, played-with section. Report + block + gift live here.
 *
 * Reseller / inventory flows live on /app/inventory.
 */
export function FriendsClient() {
  const social = useSocial();
  const safety = useSafety();
  const inventory = useInventory();

  const [copied, setCopied] = useState(false);
  const [lookupInput, setLookupInput] = useState("");
  const [lookupMessage, setLookupMessage] = useState<{ kind: "idle" | "ok" | "error"; message: string }>({ kind: "idle", message: "" });
  const [reportTarget, setReportTarget] = useState<{ code: FriendCode; displayName: string } | null>(null);
  const [giftTarget, setGiftTarget] = useState<{ code: FriendCode; displayName: string } | null>(null);

  const pendingInbox = useMemo(
    () => social.inbox.filter((invite) => invite.status === "pending"),
    [social.inbox],
  );
  const pendingOutgoing = useMemo(
    () => social.outgoing.filter((invite) => invite.status === "pending"),
    [social.outgoing],
  );

  // Only show played-with entries that AREN'T already friends and AREN'T blocked.
  const friendlySuggestions = useMemo(() => {
    const friendCodes = new Set(social.friends.map((f) => f.code));
    const blockedCodes = new Set(safety.blocks.map((b) => b.code));
    return social.playedWith.filter(
      (entry) => !friendCodes.has(entry.code) && !blockedCodes.has(entry.code),
    );
  }, [social.friends, social.playedWith, safety.blocks]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(social.selfCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard might fail in some browsers — silent */
    }
  }

  function lookupAndInvite() {
    const trimmed = lookupInput.trim();
    if (!trimmed) return;
    const code = normalizeFriendCode(trimmed);
    if (!isFriendCodeShape(code)) {
      setLookupMessage({ kind: "error", message: "That doesn't look like a friend code." });
      return;
    }
    const target = social.lookup(code);
    if (!target) {
      // Friend codes are PRIVATE: a code only resolves if you've already played with that keeper.
      setLookupMessage({
        kind: "error",
        message: "We can't find that keeper. Friend invites only go to people you've already played with — visit each other's rooms or gardens first.",
      });
      return;
    }
    if (target.relationship === "self") {
      setLookupMessage({ kind: "error", message: "That's your own code." });
      return;
    }
    if (target.relationship === "friend") {
      setLookupMessage({ kind: "ok", message: `${target.displayName} is already a friend.` });
      return;
    }
    const result = social.sendInvite(code, `${getCachedPublicUsername()} wants to be friends.`);
    if (result.ok) {
      setLookupMessage({ kind: "ok", message: `Invite sent to ${target.displayName}.` });
      setLookupInput("");
    } else {
      const msg =
        result.reason === "already-friends" ? "Already friends."
        : result.reason === "self" ? "That's your own code."
        : result.reason === "invalid-code" ? "That doesn't look like a friend code."
        : "You can only invite someone you've played with first.";
      setLookupMessage({ kind: "error", message: msg });
    }
  }

  function acceptInvite(inviteId: string) {
    const friend = social.acceptInvite(inviteId);
    if (friend) {
      social.recordPlayedWith({ code: friend.code, displayName: friend.displayName, context: "friend-accept" });
    }
  }

  function blockAndDecline(invite: { id: string; fromCode: FriendCode; fromDisplayName: string }) {
    safety.blockKeeper(invite.fromCode, invite.fromDisplayName);
    social.markInviteBlocked(invite.id);
  }

  function unblock(code: FriendCode) {
    safety.unblockKeeper(code);
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-cream-300 bg-cream-50/75 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Badge variant="garden">
              <Users className="size-3.5" />
              Friends
            </Badge>
            <h1 className="mt-2 font-display text-4xl text-ink-900">Your circle, kept small and warm.</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
              Friend codes are private. You can only invite someone you&apos;ve already shared a room or garden visit
              with — so spam never reaches your inbox.
            </p>
          </div>
          <div className="grid gap-2 text-right">
            <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Your friend code</p>
            <div className="flex items-center justify-end gap-2">
              <code className="rounded-md bg-cream-200 px-3 py-2 font-mono text-lg font-extrabold text-ink-900">
                {social.selfCode}
              </code>
              <CozyButton variant="warm" size="sm" onClick={copyCode}>
                {copied ? <ClipboardCheck /> : <Copy />}
                {copied ? "Copied" : "Copy"}
              </CozyButton>
            </div>
          </div>
        </div>
      </section>

      {safety.quarantined && (
        <section className="rounded-lg border border-blush-300/50 bg-blush-100/60 p-4 text-sm font-bold text-blush-700">
          <ShieldAlert className="mr-1 inline size-4" />
          Your chat is paused while our moderation team reviews recent activity. You can still play and care for your
          companion. Reach out via support if you think this is a mistake.
        </section>
      )}

      <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        {/* Inbox */}
        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <Inbox className="size-5 text-blush-500" />
            <h2 className="font-display text-2xl text-ink-900">Invite inbox</h2>
            <Badge variant="blush">{pendingInbox.length}</Badge>
          </div>
          {pendingInbox.length === 0 ? (
            <p className="mt-3 text-sm font-bold text-ink-500">
              No invites yet. People you&apos;ve played with can send one — your inbox stays quiet otherwise.
            </p>
          ) : (
            <div className="mt-3 grid gap-2">
              {pendingInbox.map((invite) => (
                <motion.div
                  layout
                  key={invite.id}
                  className="rounded-md border border-cream-300 bg-white/70 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-extrabold text-ink-900">{invite.fromDisplayName}</p>
                      <p className="font-mono text-xs text-ink-500">{invite.fromCode}</p>
                      {invite.message && (
                        <p className="mt-1 text-xs italic text-ink-700">&ldquo;{invite.message}&rdquo;</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <CozyButton size="sm" onClick={() => acceptInvite(invite.id)}>
                        Accept
                      </CozyButton>
                      <CozyButton size="sm" variant="warm" onClick={() => social.declineInvite(invite.id)}>
                        Decline
                      </CozyButton>
                      <button
                        type="button"
                        onClick={() => blockAndDecline(invite)}
                        className="inline-flex items-center gap-1 rounded-full border border-blush-300/50 bg-white/70 px-3 py-1 text-xs font-extrabold text-blush-700 hover:bg-blush-100"
                      >
                        <Ban className="size-3.5" /> Block
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </CozyCard>

        {/* Lookup + invite by code */}
        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <Send className="size-5 text-lavender-500" />
            <h2 className="font-display text-2xl text-ink-900">Send an invite</h2>
          </div>
          <p className="mt-1 text-xs font-bold text-ink-500">
            Paste a friend code. It only resolves to a keeper you&apos;ve already played with.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={lookupInput}
              onChange={(event) => {
                setLookupInput(event.target.value.toUpperCase());
                if (lookupMessage.kind !== "idle") setLookupMessage({ kind: "idle", message: "" });
              }}
              placeholder="HH-XXXXX-NNN"
              maxLength={32}
              className="w-full rounded-md border border-cream-300 bg-white p-2.5 font-mono text-sm font-extrabold text-ink-900 placeholder:font-sans placeholder:font-normal focus:border-lavender-300 focus:outline-none"
            />
            <CozyButton size="sm" onClick={lookupAndInvite}>
              <Send /> Send
            </CozyButton>
          </div>
          {lookupMessage.message && (
            <p
              className={cn(
                "mt-2 text-xs font-extrabold",
                lookupMessage.kind === "error" ? "text-blush-700" : "text-garden-700",
              )}
            >
              {lookupMessage.message}
            </p>
          )}

          {pendingOutgoing.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Pending invites you sent</p>
              <ul className="mt-2 grid gap-1">
                {pendingOutgoing.map((invite) => (
                  <li key={invite.id} className="flex items-center justify-between rounded-md border border-cream-300 bg-white/70 px-3 py-2 text-xs font-bold text-ink-700">
                    <span>
                      To <span className="font-mono">{invite.toCode}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => social.cancelInvite(invite.id)}
                      className="inline-flex items-center gap-1 text-ink-500 hover:text-blush-700"
                    >
                      <X className="size-3.5" /> Cancel
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CozyCard>
      </section>

      {/* Friend list */}
      <CozyCard className="p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-blush-500" />
          <h2 className="font-display text-2xl text-ink-900">Friends</h2>
          <Badge variant="garden">{social.friends.length}</Badge>
        </div>
        {social.friends.length === 0 ? (
          <p className="mt-3 text-sm font-bold text-ink-500">
            No friends yet. Visit a friend&apos;s room, play a game together, then send each other a code.
          </p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {social.friends.map((friend) => (
              <motion.div
                layout
                key={friend.code}
                className="rounded-md border border-cream-300 bg-white/70 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-extrabold text-ink-900">{friend.displayName}</p>
                    <p className="font-mono text-xs text-ink-500">{friend.code}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <CozyButton size="sm" variant="warm" onClick={() => setGiftTarget({ code: friend.code, displayName: friend.displayName })}>
                    <Gift /> Gift
                  </CozyButton>
                  <button
                    type="button"
                    onClick={() => setReportTarget({ code: friend.code, displayName: friend.displayName })}
                    className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white/70 px-3 py-1 text-xs font-extrabold text-ink-700 hover:bg-blush-100"
                  >
                    <Flag className="size-3.5" /> Report
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      safety.blockKeeper(friend.code, friend.displayName);
                      social.removeFriend(friend.code);
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-blush-300/50 bg-white/70 px-3 py-1 text-xs font-extrabold text-blush-700 hover:bg-blush-100"
                  >
                    <Ban className="size-3.5" /> Block
                  </button>
                  <button
                    type="button"
                    onClick={() => social.removeFriend(friend.code)}
                    className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white/70 px-3 py-1 text-xs font-extrabold text-ink-500 hover:bg-cream-200"
                  >
                    <Trash2 className="size-3.5" /> Remove
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </CozyCard>

      {/* Played with */}
      <CozyCard className="p-5">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-honey-700" />
          <h2 className="font-display text-2xl text-ink-900">Played together recently</h2>
          <Badge variant="outline">{friendlySuggestions.length}</Badge>
        </div>
        <p className="mt-1 text-xs font-bold text-ink-500">
          People you&apos;ve shared a scene with. You can send any of them a friend invite (and they&apos;ll get a chance to accept).
        </p>
        {friendlySuggestions.length === 0 ? (
          <p className="mt-3 text-sm font-bold text-ink-500">
            No recent co-players yet — invite someone to your room or garden first.
          </p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {friendlySuggestions.slice(0, 12).map((entry) => (
              <div
                key={entry.code}
                className="rounded-md border border-cream-300 bg-white/70 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-extrabold text-ink-900">{entry.displayName}</p>
                    <p className="font-mono text-xs text-ink-500">{entry.code}</p>
                    <p className="text-xs font-bold text-ink-500">via {entry.context}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <CozyButton size="sm" onClick={() => {
                    const result = social.sendInvite(entry.code, `${getCachedPublicUsername()} wants to be friends.`);
                    if (!result.ok && result.reason === "already-friends") {
                      // Surface clearly even though button shouldn't be visible.
                    }
                  }}>
                    <Send /> Invite
                  </CozyButton>
                  <button
                    type="button"
                    onClick={() => setReportTarget({ code: entry.code, displayName: entry.displayName })}
                    className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white/70 px-3 py-1 text-xs font-extrabold text-ink-700 hover:bg-blush-100"
                  >
                    <Flag className="size-3.5" /> Report
                  </button>
                  <button
                    type="button"
                    onClick={() => safety.blockKeeper(entry.code, entry.displayName)}
                    className="inline-flex items-center gap-1 rounded-full border border-blush-300/50 bg-white/70 px-3 py-1 text-xs font-extrabold text-blush-700 hover:bg-blush-100"
                  >
                    <Ban className="size-3.5" /> Block
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CozyCard>

      {/* Blocks + received gifts overview */}
      <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-blush-500" />
            <h2 className="font-display text-2xl text-ink-900">Blocked keepers</h2>
            <Badge variant="outline">{safety.blocks.length}</Badge>
          </div>
          {safety.blocks.length === 0 ? (
            <p className="mt-3 text-sm font-bold text-ink-500">No one&apos;s blocked. You&apos;re in good company.</p>
          ) : (
            <ul className="mt-3 grid gap-1.5">
              {safety.blocks.map((entry) => (
                <li key={entry.code} className="flex items-center justify-between rounded-md border border-cream-300 bg-white/70 px-3 py-2 text-sm font-bold text-ink-700">
                  <span>
                    <span className="block">{entry.displayName}</span>
                    <span className="font-mono text-xs text-ink-500">{entry.code}</span>
                  </span>
                  <CozyButton size="sm" variant="warm" onClick={() => unblock(entry.code)}>Unblock</CozyButton>
                </li>
              ))}
            </ul>
          )}
        </CozyCard>

        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <Gift className="size-5 text-lavender-500" />
            <h2 className="font-display text-2xl text-ink-900">Gifts waiting</h2>
            <Badge variant="garden">{inventory.giftsReceived.length}</Badge>
          </div>
          {inventory.giftsReceived.length === 0 ? (
            <p className="mt-3 text-sm font-bold text-ink-500">No unopened gifts. Send one to a friend to start a tradition.</p>
          ) : (
            <ul className="mt-3 grid gap-1.5">
              {inventory.giftsReceived.map((gift) => {
                const catalog = inventory.resolveCatalogItem(gift.catalogItemId);
                return (
                  <li key={gift.id} className="flex items-center justify-between rounded-md border border-cream-300 bg-white/70 px-3 py-2 text-sm font-bold text-ink-700">
                    <span>
                      <span className="block">{catalog?.name ?? gift.catalogItemId}</span>
                      <span className="text-xs text-ink-500">from {gift.fromDisplayName}</span>
                    </span>
                    <CozyButton size="sm" onClick={() => inventory.claimReceivedGift(gift.id)}>Open</CozyButton>
                  </li>
                );
              })}
            </ul>
          )}
        </CozyCard>
      </section>

      {reportTarget && (
        <ReportDialog
          open={Boolean(reportTarget)}
          onClose={() => setReportTarget(null)}
          offender={reportTarget}
          reporterCode={social.selfCode}
          scene="/app/friends"
        />
      )}
      {giftTarget && (
        <GiftDialog
          open={Boolean(giftTarget)}
          onClose={() => setGiftTarget(null)}
          recipient={giftTarget}
        />
      )}
    </div>
  );
}
