"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldAlert, X } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { useSafety } from "@/lib/game/use-safety";
import type { FriendCode } from "@/lib/game/social";
import type { ReportReason } from "@/lib/game/safety";
import { cn } from "@/lib/utils";

const REASONS: { value: ReportReason; label: string; help: string }[] = [
  { value: "harassment", label: "Harassment or bullying", help: "Insulting, threatening, or hostile messages." },
  { value: "explicit-content", label: "Sexual / explicit content", help: "Soliciting or sharing sexual content." },
  { value: "grooming-suspected", label: "Possible grooming", help: "Predatory phrasing, secrecy asks, age-asks toward a minor." },
  { value: "spam-or-scam", label: "Spam or scam", help: "Repeated unwanted messages or fraud." },
  { value: "hate-speech", label: "Hate speech", help: "Slurs or hate targeting an identity." },
  { value: "other", label: "Something else", help: "Anything else worth flagging." },
];

type ReportDialogProps = {
  open: boolean;
  onClose: () => void;
  offender: { code: FriendCode; displayName: string };
  /** Optional scene context, e.g. "/app/garden". */
  scene?: string;
  /** Optional chat transcript snippet at the time of the offense. */
  chatExcerpt?: string;
  reporterCode: FriendCode;
};

/**
 * ReportDialog — submits a structured report to the safety layer.
 *
 * The record captures the offender's PUBLIC display info (friend code, name,
 * scene, transcript) and the chosen reason. Server-side, an authorized admin
 * (you) can join this with `auth.users` to recover the offender's auth metadata
 * (email, last-seen IP, user-agent) when responding to a legitimate legal
 * process — but we never auto-exfiltrate that PII to the client.
 */
export function ReportDialog({ open, onClose, offender, scene, chatExcerpt, reporterCode }: ReportDialogProps) {
  const safety = useSafety();
  const [reason, setReason] = useState<ReportReason>("harassment");
  const [details, setDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function submit() {
    safety.submitReport({
      reporterCode,
      offenderCode: offender.code,
      offenderDisplayName: offender.displayName,
      reason,
      details: details.trim() || undefined,
      chatExcerpt,
      scene,
      autoFlagged: false,
    });
    setSubmitted(true);
    window.setTimeout(() => {
      setSubmitted(false);
      setReason("harassment");
      setDetails("");
      onClose();
    }, 1600);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="report-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] grid place-items-center bg-ink-900/45 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 12, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="w-[min(480px,100%)] rounded-lg border border-cream-300 bg-cream-50 p-5 shadow-[0_24px_60px_-22px_rgba(91,63,63,0.55)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Report ${offender.displayName}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-blush-500" />
                <h2 className="font-display text-xl text-ink-900">Report {offender.displayName}</h2>
              </div>
              <button
                onClick={onClose}
                className="grid size-8 place-items-center rounded-full text-ink-500 transition-colors hover:bg-cream-200"
                aria-label="Close"
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-1 text-xs font-bold text-ink-500">
              Reports go to the moderation queue. Auto-flagged severe content already restricts the sender; a human review
              extends or clears the action.
            </p>

            <div className="mt-4 grid gap-2">
              {REASONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setReason(option.value)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left transition-colors",
                    reason === option.value
                      ? "border-blush-300 bg-blush-100 text-ink-900"
                      : "border-cream-300 bg-white/70 text-ink-700 hover:border-blush-300/60 hover:bg-blush-100/40",
                  )}
                >
                  <span className="block text-sm font-extrabold">{option.label}</span>
                  <span className="block text-xs font-bold text-ink-500">{option.help}</span>
                </button>
              ))}
            </div>

            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Anything else our moderation team should know? (optional)"
              maxLength={500}
              className="mt-4 h-24 w-full resize-none rounded-md border border-cream-300 bg-white p-3 text-sm font-bold text-ink-900 focus:border-blush-300 focus:outline-none"
            />

            <div className="mt-4 flex justify-end gap-2">
              <CozyButton variant="warm" size="sm" onClick={onClose} disabled={submitted}>
                Cancel
              </CozyButton>
              <CozyButton size="sm" onClick={submit} disabled={submitted}>
                {submitted ? "Sent to moderation" : "Submit report"}
              </CozyButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
