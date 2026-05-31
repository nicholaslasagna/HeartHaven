"use client";

import { Gift, Sparkles } from "lucide-react";
import { useState } from "react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  getCompanionRoster,
  replaceCompanionRosterState,
} from "@/lib/game/companion-roster";
import {
  getPetVitals,
  replacePetVitalsState,
} from "@/lib/game/pet-state";
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
  replacePetVitalsState(serverPet.vitals);
}

export function RedemptionCodePanel() {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
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
      if (error) throw error;

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
      setNotice({
        kind: "ok",
        message: row.message ?? `${row.reward_pet_name ?? "A new companion"} joined your roster.`,
      });
    } catch {
      setNotice({ kind: "error", message: "That code could not be redeemed right now. Try again in a moment." });
    } finally {
      setPending(false);
    }
  }

  return (
    <CozyCard className="overflow-hidden p-5">
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
