"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Loader2, ShieldCheck, ShieldPlus, Trash2 } from "lucide-react";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type MfaFactor = {
  id: string;
  friendly_name?: string | null;
  factor_type: string;
  status: string;
};

type PendingFactor = {
  id: string;
  friendlyName: string;
  qrCode?: string;
  secret?: string;
  uri?: string;
};

export function MfaPanel() {
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [currentLevel, setCurrentLevel] = useState<string | null>(null);
  const [nextLevel, setNextLevel] = useState<string | null>(null);
  const [pendingFactor, setPendingFactor] = useState<PendingFactor | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [sessionCode, setSessionCode] = useState("");
  const [status, setStatus] = useState("Loading security status");
  const [busy, setBusy] = useState(false);

  const verifiedTotpFactors = useMemo(
    () => factors.filter((factor) => factor.factor_type === "totp" && factor.status === "verified"),
    [factors],
  );

  const loadMfaState = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setStatus("Live security controls are not available in this build yet.");
      return;
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const [{ data: factorData, error: factorError }, { data: aalData, error: aalError }] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);

      if (factorError) throw factorError;
      if (aalError) throw aalError;

      setFactors(factorData.all as MfaFactor[]);
      setCurrentLevel(aalData.currentLevel);
      setNextLevel(aalData.nextLevel);
      setStatus("Account security loaded");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load MFA state");
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadMfaState();
    });
  }, [loadMfaState]);

  async function startEnrollment() {
    setBusy(true);
    setStatus("Creating authenticator setup");

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "HeartHaven Authenticator",
      });

      if (error) throw error;

      setPendingFactor({
        id: data.id,
        friendlyName: data.friendly_name ?? "HeartHaven Authenticator",
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
        uri: data.totp.uri,
      });
      setStatus("Scan the QR code, then enter the 6-digit authenticator code.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create MFA factor");
    } finally {
      setBusy(false);
    }
  }

  async function verifyEnrollment() {
    if (!pendingFactor) return;
    setBusy(true);
    setStatus("Verifying authenticator code");

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: pendingFactor.id,
      });

      if (challengeError) throw challengeError;

      const { error } = await supabase.auth.mfa.verify({
        factorId: pendingFactor.id,
        challengeId: challenge.id,
        code: enrollCode.trim(),
      });

      if (error) throw error;

      setPendingFactor(null);
      setEnrollCode("");
      setStatus("Two-factor authentication is enabled.");
      await loadMfaState();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not verify MFA code");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCurrentSession(factorId: string) {
    setBusy(true);
    setStatus("Verifying this session");

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: sessionCode.trim(),
      });

      if (error) throw error;

      setSessionCode("");
      setStatus("This browser session is now verified with 2FA.");
      await loadMfaState();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not verify this session");
    } finally {
      setBusy(false);
    }
  }

  async function removeFactor(factorId: string) {
    setBusy(true);
    setStatus("Removing authenticator factor");

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.mfa.unenroll({ factorId });

      if (error) throw error;

      setStatus("Two-factor factor removed.");
      await loadMfaState();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not remove MFA factor");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CozyCard className="p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-lavender-500">
            <ShieldCheck className="size-4" /> Two-factor authentication
          </p>
          <h2 className="mt-2 font-display text-3xl text-ink-900">Account protection</h2>
          <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-ink-700">
            Add an authenticator app code before private gardens, love notes, and memory pages become live account
            features.
          </p>
        </div>
        <div className="rounded-lg border border-cream-300 bg-cream-100 px-3 py-2 text-xs font-black uppercase tracking-normal text-ink-700">
          Current {currentLevel ?? "none"} / Next {nextLevel ?? "aal1"}
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        {verifiedTotpFactors.length === 0 && !pendingFactor && (
          <Button onClick={startEnrollment} disabled={busy || !isSupabaseConfigured()} className="w-fit">
            {busy ? <Loader2 className="animate-spin" /> : <ShieldPlus />} Enable authenticator 2FA
          </Button>
        )}

        {pendingFactor && (
          <div className="grid gap-4 rounded-lg border border-lavender-200 bg-lavender-100/55 p-4 md:grid-cols-[180px_minmax(0,1fr)]">
            <div className="grid place-items-center rounded-lg bg-white p-3">
              {pendingFactor.qrCode ? (
                // Supabase returns the QR as an SVG data URL for TOTP enrollment.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pendingFactor.qrCode} alt={pendingFactor.uri ?? "HeartHaven authenticator QR code"} />
              ) : (
                <KeyRound className="size-14 text-lavender-500" />
              )}
            </div>
            <div className="grid gap-3">
              <p className="text-sm font-black text-ink-900">{pendingFactor.friendlyName}</p>
              {pendingFactor.secret && (
                <p className="break-all rounded-md bg-white/70 p-2 font-mono text-xs font-bold text-ink-700">
                  {pendingFactor.secret}
                </p>
              )}
              <label className="grid gap-2 text-sm font-extrabold text-ink-700">
                6-digit code
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setEnrollCode(event.target.value)}
                  value={enrollCode}
                />
              </label>
              <Button onClick={verifyEnrollment} disabled={busy || enrollCode.trim().length < 6} className="w-fit">
                {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Verify and enable
              </Button>
            </div>
          </div>
        )}

        {verifiedTotpFactors.map((factor) => (
          <div
            className="flex flex-col gap-3 rounded-lg border border-garden-300/45 bg-garden-100/60 p-4 md:flex-row md:items-center md:justify-between"
            key={factor.id}
          >
            <div>
              <p className="text-sm font-black text-ink-900">{factor.friendly_name ?? "Authenticator app"}</p>
              <p className="text-xs font-bold uppercase tracking-normal text-garden-700">{factor.status}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {currentLevel !== "aal2" && (
                <>
                  <Input
                    className="w-36"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => setSessionCode(event.target.value)}
                    placeholder="2FA code"
                    value={sessionCode}
                  />
                  <Button
                    onClick={() => verifyCurrentSession(factor.id)}
                    disabled={busy || sessionCode.trim().length < 6}
                    variant="warm"
                  >
                    Verify session
                  </Button>
                </>
              )}
              <Button onClick={() => removeFactor(factor.id)} disabled={busy} variant="secondary">
                <Trash2 /> Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 rounded-lg bg-white/70 p-3 text-xs font-bold leading-5 text-ink-700">{status}</p>
    </CozyCard>
  );
}
