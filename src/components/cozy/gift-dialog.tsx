"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, X } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { useInventory } from "@/lib/game/use-inventory";
import { useSocial } from "@/lib/game/use-social";
import type { FriendCode } from "@/lib/game/social";
import { cn } from "@/lib/utils";

type GiftDialogProps = {
  open: boolean;
  onClose: () => void;
  recipient: { code: FriendCode; displayName: string };
};

/**
 * GiftDialog — pick an item from the keeper's inventory and send it to a
 * friend. The transfer is atomic: the item leaves the sender's inventory the
 * moment "Send" succeeds, and a gift record lands in the recipient's inbox.
 */
export function GiftDialog({ open, onClose, recipient }: GiftDialogProps) {
  const inventory = useInventory();
  const social = useSocial();
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "error"; message: string }>({ kind: "idle", message: "" });

  const giftable = useMemo(
    () => inventory.view.filter((row) => row.entry.quantity > 0 && !row.entry.equipped),
    [inventory.view],
  );

  function send() {
    if (!selectedEntryId) return;
    const result = inventory.giftItem({
      entryId: selectedEntryId,
      toCode: recipient.code,
      toDisplayName: recipient.displayName,
      selfCode: social.selfCode,
      selfDisplayName: social.selfDisplayName,
    });
    if (result.ok) {
      setStatus({ kind: "ok", message: `Sent to ${recipient.displayName}.` });
      setSelectedEntryId(null);
      window.setTimeout(() => {
        setStatus({ kind: "idle", message: "" });
        onClose();
      }, 1500);
    } else {
      const msg =
        result.reason === "self" ? "You can't gift yourself."
        : result.reason === "empty" ? "You don't have any of those left."
        : "Item not found.";
      setStatus({ kind: "error", message: msg });
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="gift-overlay"
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
            className="w-[min(520px,100%)] rounded-lg border border-cream-300 bg-cream-50 p-5 shadow-[0_24px_60px_-22px_rgba(91,63,63,0.55)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Send a gift to ${recipient.displayName}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Gift className="size-5 text-lavender-500" />
                <h2 className="font-display text-xl text-ink-900">Send a gift to {recipient.displayName}</h2>
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
              The item leaves your inventory the moment it sends. Equipped items can&apos;t be gifted.
            </p>

            <div className="mt-4 max-h-72 overflow-y-auto pr-1">
              {giftable.length === 0 ? (
                <p className="rounded-md border border-cream-300 bg-white/70 p-4 text-sm font-bold text-ink-500">
                  Nothing un-equipped to gift right now. Unequip an item or earn one in your daily gift.
                </p>
              ) : (
                <div className="grid gap-2">
                  {giftable.map((row) => (
                    <button
                      key={row.entry.id}
                      type="button"
                      onClick={() => setSelectedEntryId(row.entry.id)}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                        selectedEntryId === row.entry.id
                          ? "border-lavender-300 bg-lavender-100/70 text-ink-900"
                          : "border-cream-300 bg-white/70 text-ink-700 hover:border-lavender-300/60",
                      )}
                    >
                      <span>
                        <span className="block text-sm font-extrabold">{row.catalog.name}</span>
                        <span className="block text-xs font-bold text-ink-500">
                          {row.catalog.category} · qty {row.entry.quantity}
                        </span>
                      </span>
                      <span className="text-xs font-extrabold text-honey-700">
                        {row.catalog.priceCoins} coins value
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {status.message && (
              <p
                className={cn(
                  "mt-3 text-sm font-extrabold",
                  status.kind === "error" ? "text-blush-700" : "text-garden-700",
                )}
              >
                {status.message}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <CozyButton variant="warm" size="sm" onClick={onClose}>Cancel</CozyButton>
              <CozyButton size="sm" onClick={send} disabled={!selectedEntryId}>
                <Gift /> Send gift
              </CozyButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
