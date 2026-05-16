"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Ban,
  ClipboardCheck,
  Copy,
  Flag,
  Gift,
  Inbox,
  LinkIcon,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/cozy/confirm-dialog";
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
  const router = useRouter();
  const searchParams = useSearchParams();

  const [copied, setCopied] = useState(false);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [lookupInput, setLookupInput] = useState("");
  const [lookupMessage, setLookupMessage] = useState<{ kind: "idle" | "ok" | "error"; message: string; linkToShare?: string }>({ kind: "idle", message: "" });
  const [acceptInput, setAcceptInput] = useState("");
  const [acceptMessage, setAcceptMessage] = useState<{ kind: "idle" | "ok" | "error"; message: string }>({ kind: "idle", message: "" });
  const [reportTarget, setReportTarget] = useState<{ code: FriendCode; displayName: string } | null>(null);
  const [giftTarget, setGiftTarget] = useState<{ code: FriendCode; displayName: string } | null>(null);
  /**
   * Target of a pending Yes/No confirmation. `kind` selects which destructive
   * action the user is being asked to confirm — every block call now routes
   * through this dialog instead of firing instantly, so no one gets blocked
   * by an accidental click.
   */
  const [confirmTarget, setConfirmTarget] = useState<
    | { kind: "block-friend"; code: FriendCode; displayName: string }
    | { kind: "block-invite"; invite: { id: string; fromCode: FriendCode; fromDisplayName: string } }
    | { kind: "block-played"; code: FriendCode; displayName: string }
    | { kind: "remove-friend"; code: FriendCode; displayName: string }
    | null
  >(null);

  function performConfirmed() {
    if (!confirmTarget) return;
    if (confirmTarget.kind === "block-friend") {
      safety.blockKeeper(confirmTarget.code, confirmTarget.displayName);
      social.removeFriend(confirmTarget.code);
    } else if (confirmTarget.kind === "block-invite") {
      safety.blockKeeper(confirmTarget.invite.fromCode, confirmTarget.invite.fromDisplayName);
      social.markInviteBlocked(confirmTarget.invite.id);
    } else if (confirmTarget.kind === "block-played") {
      safety.blockKeeper(confirmTarget.code, confirmTarget.displayName);
    } else if (confirmTarget.kind === "remove-friend") {
      social.removeFriend(confirmTarget.code);
    }
    setConfirmTarget(null);
  }

  function confirmCopy() {
    if (!confirmTarget) return { title: "", description: "" };
    const target =
      confirmTarget.kind === "block-invite"
        ? { displayName: confirmTarget.invite.fromDisplayName, code: confirmTarget.invite.fromCode }
        : { displayName: confirmTarget.displayName, code: confirmTarget.code };
    if (confirmTarget.kind === "remove-friend") {
      return {
        title: `Remove ${target.displayName} from your friends?`,
        description: "They won't be able to send you invites or gifts. You can re-add them later if you want.",
        confirmLabel: "Yes, remove",
      };
    }
    return {
      title: `Block ${target.displayName}?`,
      description:
        "Blocking hides their chat, invites, gifts, and presence from you everywhere in HeartHaven. You can unblock them from this page later.",
      confirmLabel: "Yes, block",
    };
  }

  // Auto-redeem a `?accept=<token>` URL the sender pasted to the recipient.
  // The redeem itself writes to localStorage, so we defer the React setState
  // calls to a microtask to keep this effect a pure side-effect runner.
  useEffect(() => {
    if (!social.ready) return;
    const token = searchParams.get("accept");
    if (!token) return;
    const result = social.redeemToken(token);
    const reason = "reason" in result ? result.reason : undefined;
    queueMicrotask(() => {
      if (result.ok) {
        setAcceptMessage({ kind: "ok", message: `Invite from ${result.invite.fromDisplayName} added to your inbox.` });
      } else if (reason === "duplicate") {
        setAcceptMessage({ kind: "ok", message: "That invite is already in your inbox." });
      } else if (reason === "already-friends") {
        setAcceptMessage({ kind: "ok", message: "You're already friends with that keeper." });
      } else {
        setAcceptMessage({ kind: "error", message: "That invite link couldn't be read." });
      }
    });
    // Clear the query param so a refresh doesn't re-trigger.
    router.replace("/app/friends");
  }, [searchParams, social, router]);

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
      setLookupMessage({ kind: "error", message: "Friend codes look like HH-XXXXX-NNN. Double-check the letters and digits." });
      return;
    }
    const target = social.lookup(code);
    if (target?.relationship === "self") {
      setLookupMessage({ kind: "error", message: "That's your own code." });
      return;
    }
    if (target?.relationship === "friend") {
      setLookupMessage({ kind: "ok", message: `${target.displayName} is already a friend.` });
      return;
    }
    const result = social.sendInvite(code, `${getCachedPublicUsername()} wants to be friends.`);
    if (result.ok) {
      const link = social.buildLink(result.invite);
      const displayName = target?.displayName && target.relationship !== "stranger" ? target.displayName : code;
      setLookupMessage({
        kind: "ok",
        message: `Invite ready for ${displayName}. Send them this link to accept.`,
        linkToShare: link,
      });
      setLookupInput("");
    } else {
      const msg =
        result.reason === "already-friends" ? "Already friends."
        : result.reason === "self" ? "That's your own code."
        : "Friend codes look like HH-XXXXX-NNN.";
      setLookupMessage({ kind: "error", message: msg });
    }
  }

  /**
   * Accept an invite the recipient received out-of-band — they paste either
   * a full invite URL (with `?accept=<token>`) or just the raw friend code
   * of the person inviting them. Either way we drop a pending invite into
   * the inbox so they can Accept/Decline like any other.
   */
  function redeemPastedInvite() {
    const trimmed = acceptInput.trim();
    if (!trimmed) return;

    // 1. Try parsing as a URL with ?accept=<token> first.
    try {
      const url = new URL(trimmed);
      const token = url.searchParams.get("accept");
      if (token) {
        const result = social.redeemToken(token);
        if (result.ok) {
          setAcceptMessage({ kind: "ok", message: `Invite from ${result.invite.fromDisplayName} added to your inbox.` });
          setAcceptInput("");
          return;
        }
        const reason = "reason" in result ? result.reason : undefined;
        if (reason === "duplicate") {
          setAcceptMessage({ kind: "ok", message: "That invite is already in your inbox." });
          setAcceptInput("");
        } else if (reason === "already-friends") {
          setAcceptMessage({ kind: "ok", message: "You're already friends with that keeper." });
          setAcceptInput("");
        } else if (reason === "self") {
          setAcceptMessage({ kind: "error", message: "That's your own invite link." });
        } else {
          setAcceptMessage({ kind: "error", message: "That invite link couldn't be read." });
        }
        return;
      }
      // URL with ?visit=...&room=... — navigate inline so the visit flow opens.
      if (url.searchParams.get("visit")) {
        const path = `${url.pathname}${url.search}` || "/app/area";
        router.push(path);
        setAcceptInput("");
        return;
      }
    } catch {
      // Not a URL — fall through to raw-code path.
    }

    // 2. Treat the input as a raw friend code (HH-XXXXX-NNN).
    const code = normalizeFriendCode(trimmed);
    if (!isFriendCodeShape(code)) {
      setAcceptMessage({
        kind: "error",
        message: "Paste an invite link, or a friend code shaped like HH-XXXXX-NNN.",
      });
      return;
    }
    const result = social.redeemCode(code);
    if (result.ok) {
      setAcceptMessage({ kind: "ok", message: `Invite from ${result.invite.fromCode} added to your inbox.` });
      setAcceptInput("");
    } else if (result.reason === "duplicate") {
      setAcceptMessage({ kind: "ok", message: "That invite is already in your inbox." });
      setAcceptInput("");
    } else if (result.reason === "already-friends") {
      setAcceptMessage({ kind: "ok", message: "You're already friends with that keeper." });
      setAcceptInput("");
    } else if (result.reason === "self") {
      setAcceptMessage({ kind: "error", message: "That's your own code." });
    } else {
      setAcceptMessage({ kind: "error", message: "That doesn't look like a friend code." });
    }
  }

  async function copyShareLink(link: string, id: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLinkId(id);
      window.setTimeout(() => setCopiedLinkId((current) => (current === id ? null : current)), 2000);
    } catch {
      /* clipboard may fail in some browsers — keep the link visible so user can copy manually */
    }
  }

  function acceptInvite(inviteId: string) {
    const friend = social.acceptInvite(inviteId);
    if (friend) {
      social.recordPlayedWith({ code: friend.code, displayName: friend.displayName, context: "friend-accept" });
    }
  }

  function blockAndDecline(invite: { id: string; fromCode: FriendCode; fromDisplayName: string }) {
    setConfirmTarget({ kind: "block-invite", invite });
  }

  function unblock(code: FriendCode) {
    safety.unblockKeeper(code);
  }

  return (
    <div className="grid gap-5">
      <section className="hh-card relative overflow-hidden p-5">
        <div className="pointer-events-none absolute inset-0 hh-bg-paper opacity-40" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <Badge variant="garden">
              <Users className="size-3.5" />
              Friends
            </Badge>
            <h1 className="hh-display mt-2 text-4xl text-ink-900">Your circle, kept small and warm.</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
              Send an invite by friend code and your friend sees it instantly in their inbox. If you&apos;re offline
              first, share the link below — either way, you stay in control of who joins.
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
              No invites yet. When someone sends you a friend invite link, it shows up here for you to accept or
              decline.
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
            Paste a friend code, hit Send, then DM the shareable link to your friend.
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
          {lookupMessage.linkToShare && (
            <div className="mt-2 flex min-w-0 items-center gap-2 overflow-hidden rounded-md border border-lavender-300/40 bg-lavender-100/60 p-2">
              <LinkIcon className="size-4 shrink-0 text-lavender-600" />
              <code
                className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-ink-800"
                title={lookupMessage.linkToShare}
              >
                {lookupMessage.linkToShare}
              </code>
              <CozyButton size="sm" variant="warm" onClick={() => copyShareLink(lookupMessage.linkToShare!, "lookup")}>
                {copiedLinkId === "lookup" ? <ClipboardCheck /> : <Copy />}
                {copiedLinkId === "lookup" ? "Copied" : "Copy"}
              </CozyButton>
            </div>
          )}

          {pendingOutgoing.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Pending invites you sent</p>
              <ul className="mt-2 grid gap-2 overflow-hidden">
                {pendingOutgoing.map((invite) => {
                  const link = social.buildLink(invite);
                  return (
                    <li key={invite.id} className="min-w-0 overflow-hidden rounded-md border border-cream-300 bg-white/70 px-3 py-2 text-xs font-bold text-ink-700">
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          To <span className="font-mono">{invite.toCode}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => social.cancelInvite(invite.id)}
                          className="inline-flex shrink-0 items-center gap-1 text-ink-500 hover:text-blush-700"
                        >
                          <X className="size-3.5" /> Cancel
                        </button>
                      </div>
                      <div className="mt-2 flex min-w-0 items-center gap-2 overflow-hidden">
                        <LinkIcon className="size-3.5 shrink-0 text-lavender-600" />
                        <code
                          className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-ink-700"
                          title={link}
                        >
                          {link}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyShareLink(link, invite.id)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cream-300 bg-white/80 px-2 py-1 text-[11px] font-extrabold text-ink-700 hover:bg-blush-100"
                        >
                          {copiedLinkId === invite.id ? <ClipboardCheck className="size-3.5" /> : <Copy className="size-3.5" />}
                          {copiedLinkId === invite.id ? "Copied" : "Copy link"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CozyCard>
      </section>

      {/* Got an invite? — paste a link or code to add it to your inbox */}
      <CozyCard className="p-5">
        <div className="flex items-center gap-2">
          <LinkIcon className="size-5 text-honey-700" />
          <h2 className="font-display text-2xl text-ink-900">Got an invite?</h2>
        </div>
        <p className="mt-1 text-xs font-bold text-ink-500">
          Paste the invite link a friend sent you, or their friend code. We&apos;ll drop the invite straight into your inbox so you can accept it.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={acceptInput}
            onChange={(event) => {
              setAcceptInput(event.target.value);
              if (acceptMessage.kind !== "idle") setAcceptMessage({ kind: "idle", message: "" });
            }}
            placeholder="Paste invite link or HH-XXXXX-NNN"
            maxLength={400}
            className="w-full rounded-md border border-cream-300 bg-white p-2.5 text-sm font-bold text-ink-900 placeholder:font-sans placeholder:font-normal focus:border-honey-500 focus:outline-none"
          />
          <CozyButton size="sm" variant="warm" onClick={redeemPastedInvite}>
            <Inbox /> Add
          </CozyButton>
        </div>
        {acceptMessage.message && (
          <p
            className={cn(
              "mt-2 text-xs font-extrabold",
              acceptMessage.kind === "error" ? "text-blush-700" : "text-garden-700",
            )}
          >
            {acceptMessage.message}
          </p>
        )}
      </CozyCard>

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
                    onClick={() =>
                      setConfirmTarget({ kind: "block-friend", code: friend.code, displayName: friend.displayName })
                    }
                    className="inline-flex items-center gap-1 rounded-full border border-blush-300/50 bg-white/70 px-3 py-1 text-xs font-extrabold text-blush-700 hover:bg-blush-100"
                  >
                    <Ban className="size-3.5" /> Block
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmTarget({ kind: "remove-friend", code: friend.code, displayName: friend.displayName })
                    }
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
                    onClick={() =>
                      setConfirmTarget({ kind: "block-played", code: entry.code, displayName: entry.displayName })
                    }
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
      <ConfirmDialog
        open={Boolean(confirmTarget)}
        onClose={() => setConfirmTarget(null)}
        onConfirm={performConfirmed}
        tone={confirmTarget?.kind === "remove-friend" ? "warm" : "danger"}
        {...confirmCopy()}
      />
    </div>
  );
}
