"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Gift, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  getCompanionRoster,
  replaceCompanionRosterState,
} from "@/lib/game/companion-roster";
import { playCozyCue } from "@/lib/game/cozy-audio";
import {
  getPetVitals,
  replacePetVitalsState,
} from "@/lib/game/pet-state";
import { recordMultiplayerRpc } from "@/lib/game/multiplayer-diagnostics";
import { loadServerPetState } from "@/lib/game/phase2-server";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type RedeemCodeResult = {
  ok: boolean;
  code_label: string | null;
  reward_type: string | null;
  reward_pet_species: string | null;
  reward_pet_name: string | null;
  message: string | null;
};

type RedeemedCompanion = {
  name: string;
  species: string;
};

function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function resultRow(data: unknown): RedeemCodeResult | null {
  if (Array.isArray(data)) return (data[0] as RedeemCodeResult | undefined) ?? null;
  return (data as RedeemCodeResult | null) ?? null;
}

async function hydrateCompanions() {
  const serverPet = await loadServerPetState(getCompanionRoster(), getPetVitals());
  if (!serverPet) return;
  replaceCompanionRosterState(serverPet.roster);
  for (const [companionId, companionVitals] of Object.entries(serverPet.vitalsByCompanion)) {
    replacePetVitalsState(companionVitals, companionId);
  }
  replacePetVitalsState(serverPet.vitals, serverPet.roster.activeId);
}

export function RedemptionCodePanel() {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [redeemedCompanion, setRedeemedCompanion] = useState<RedeemedCompanion | null>(null);
  const [notice, setNotice] = useState<{ kind: "idle" | "ok" | "error"; message: string }>({
    kind: "idle",
    message: "",
  });

  async function redeem() {
    const normalized = normalizeCode(code);
    if (normalized.length < 6) {
      setNotice({ kind: "error", message: "Enter a HeartHaven code first." });
      return;
    }
    if (!isSupabaseConfigured()) {
      setNotice({ kind: "error", message: "Online account services are not connected in this build yet." });
      return;
    }

    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("redeem_code", { p_code: normalized });
      if (error) {
        recordMultiplayerRpc("redeem_code", error);
        if (process.env.NODE_ENV !== "production") {
          console.error("[HeartHaven] redeem_code RPC failed", {
            code: error.code,
            details: error.details,
            hint: error.hint,
            message: error.message,
          });
        }
        throw error;
      }
      recordMultiplayerRpc("redeem_code");

      const row = resultRow(data);
      if (!row) {
        setNotice({ kind: "error", message: "That code could not be checked. Try again." });
        return;
      }
      if (!row.ok) {
        setNotice({ kind: "error", message: row.message ?? "That code could not be redeemed." });
        return;
      }

      await hydrateCompanions();
      setCode("");
      setRedeemedCompanion({
        name: row.reward_pet_name ?? "A new companion",
        species: row.reward_pet_species ?? "kitten",
      });
      playCozyCue("unlock");
      setNotice({
        kind: "ok",
        message: row.message ?? `${row.reward_pet_name ?? "A new companion"} joined your roster.`,
      });
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[HeartHaven] redemption failed", error);
      }
      setNotice({ kind: "error", message: "That code could not be redeemed right now. Try again in a moment." });
    } finally {
      setPending(false);
    }
  }

  return (
    <CozyCard className="overflow-hidden p-5">
      <AnimatePresence>
        {redeemedCompanion && (
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[180] grid place-items-center bg-ink-900/45 px-4 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
          >
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-honey-200 bg-gradient-to-br from-white via-blush-50 to-lavender-100 p-6 text-center shadow-[0_28px_80px_rgba(91,63,63,0.35)]"
              exit={{ opacity: 0, scale: 0.94, y: 10 }}
              initial={{ opacity: 0, scale: 0.9, y: 18 }}
              transition={{ type: "spring", stiffness: 210, damping: 20 }}
            >
              <button
                aria-label="Close redeemed companion celebration"
                className="absolute right-3 top-3 grid size-9 place-items-center rounded-full border border-cream-300 bg-white/80 text-ink-700 shadow-sm transition hover:bg-white"
                onClick={() => setRedeemedCompanion(null)}
                type="button"
              >
                <X className="size-4" />
              </button>
              <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_50%_0%,rgba(218,165,62,0.35),transparent_62%)]" />
              <motion.div
                animate={{ rotate: [0, -2, 2, 0], scale: [1, 1.04, 1] }}
                className="mx-auto grid h-48 place-items-center"
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              >
                <Image
                  alt={`${redeemedCompanion.name} idle pose`}
                  className="max-h-44 w-auto object-contain drop-shadow-[0_18px_28px_rgba(91,63,63,0.22)]"
                  height={288}
                  priority
                  src={`/game-assets/generated/pet-art-preview-${redeemedCompanion.species}.png`}
                  width={256}
                />
              </motion.div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-honey-700">Secret companion unlocked</p>
              <h3 className="mt-2 font-display text-4xl text-ink-900">
                You just redeemed {redeemedCompanion.name}
              </h3>
              <p className="mx-auto mt-2 max-w-sm text-sm font-bold leading-6 text-ink-700">
                They joined your companion roster and are ready to fly through HeartHaven with you.
              </p>
              <CozyButton className="mt-5" onClick={() => setRedeemedCompanion(null)}>
                <Sparkles /> Bring them home
              </CozyButton>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Badge variant="blush">
            <Gift className="size-3.5" /> Secret companion code
          </Badge>
          <h2 className="mt-2 font-display text-2xl text-ink-900">Redeem a HeartHaven code</h2>
          <p className="mt-1 max-w-xl text-sm font-bold leading-6 text-ink-700">
            Special event and gift codes can unlock private companions for your roster. Codes can only be used once on
            each account.
          </p>
        </div>
        <Sparkles className="hidden size-10 text-honey-500 sm:block" />
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Input
          aria-label="HeartHaven redemption code"
          autoComplete="off"
          className="h-12 flex-1 font-black uppercase tracking-normal"
          disabled={pending}
          maxLength={32}
          onChange={(event) => setCode(normalizeCode(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === "Enter") void redeem();
          }}
          placeholder="PASTE CODE"
          value={code}
        />
        <CozyButton className="h-12 sm:min-w-36" disabled={pending} onClick={() => void redeem()}>
          {pending ? "Checking..." : "Redeem"}
        </CozyButton>
      </div>

      {notice.kind !== "idle" && (
        <p
          className={`mt-3 rounded-lg border px-3 py-2 text-sm font-extrabold ${
            notice.kind === "ok"
              ? "border-garden-200 bg-garden-100/70 text-garden-800"
              : "border-blush-200 bg-blush-100/70 text-blush-800"
          }`}
        >
          {notice.message}
        </p>
      )}
    </CozyCard>
  );
}
