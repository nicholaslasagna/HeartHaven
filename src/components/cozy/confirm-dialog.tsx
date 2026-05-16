"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  /** Primary action label (the destructive one). Defaults to "Yes, do it". */
  confirmLabel?: string;
  /** Secondary action label. Defaults to "No, never mind". */
  cancelLabel?: string;
  /** Tone of the confirm button — `danger` = blush/red, `warm` = pink, `default` = primary. */
  tone?: "danger" | "warm" | "default";
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * A reusable Yes/No confirmation dialog. Used anywhere a destructive or
 * irreversible action needs an explicit affirmative — currently the most
 * visible call site is "Block this keeper", but the same component is also
 * used for "Remove friend", "Reset room", and similar.
 *
 * Keyboard: Esc closes, Enter confirms (when focused on the dialog).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Yes, do it",
  cancelLabel = "No, never mind",
  tone = "danger",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="confirm-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] grid place-items-center bg-ink-900/45 backdrop-blur-sm p-4"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            initial={{ y: 12, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="w-[min(420px,100%)] rounded-lg border border-cream-300 bg-cream-50 p-5 shadow-[0_24px_60px_-22px_rgba(91,63,63,0.55)]"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "Enter") onConfirm();
            }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="flex items-start gap-3">
              <ShieldAlert
                className={`mt-0.5 size-5 shrink-0 ${
                  tone === "danger" ? "text-blush-500" : tone === "warm" ? "text-honey-700" : "text-lavender-500"
                }`}
              />
              <div>
                <h2 className="font-display text-xl text-ink-900">{title}</h2>
                {description && (
                  <p className="mt-2 text-sm font-bold leading-5 text-ink-700">{description}</p>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <CozyButton variant="warm" size="sm" onClick={onClose}>
                {cancelLabel}
              </CozyButton>
              <CozyButton size="sm" onClick={onConfirm}>
                {confirmLabel}
              </CozyButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
