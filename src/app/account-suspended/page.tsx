import Link from "next/link";
import { CheckCircle2, ShieldAlert, Timer } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabaseConfig, isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Shown when the middleware (or BanWatchdog) detects a banned session
 * and signs the keeper out. The `ref` query param is the ban id; we
 * read a PII-free summary (`reason` + `created_at` + `expires_at`)
 * through the `get_ban_summary` RPC, which is callable by anon by
 * design — the page renders even after sign-out.
 *
 * The same page handles three states by reading `expires_at`:
 *   • permanent  (expires_at IS NULL) — "permanently suspended"
 *   • temporary  (expires_at > now)   — "suspended until <date>"
 *   • expired    (expires_at <= now)  — "suspension ended, sign back in"
 */
async function loadBanSummary(refRaw: string | undefined) {
  if (!refRaw) return null;
  if (!isSupabaseConfigured()) return null;
  if (!/^[0-9a-fA-F-]{30,40}$/.test(refRaw)) return null;
  try {
    const { url, anonKey } = getSupabaseConfig();
    if (!url || !anonKey) return null;
    const cookieStore = await cookies();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          /* read-only on this page */
        },
      },
    });
    const { data, error } = await supabase.rpc("get_ban_summary", { p_ban_id: refRaw });
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as { reason?: string; created_at?: string; expires_at?: string | null };
    return {
      reason: typeof row.reason === "string" ? row.reason : null,
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
      expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
    };
  } catch {
    return null;
  }
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type BanState = "permanent" | "temporary-active" | "expired" | "unknown";

function classifyBan(summary: { expiresAt: string | null } | null): BanState {
  if (!summary) return "unknown";
  if (!summary.expiresAt) return "permanent";
  const expiresMs = new Date(summary.expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) return "permanent";
  return expiresMs > Date.now() ? "temporary-active" : "expired";
}

export default async function AccountSuspendedPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const summary = await loadBanSummary(ref);
  const state = classifyBan(summary);
  const issuedLabel = formatDateTime(summary?.createdAt);
  const expiresLabel = formatDateTime(summary?.expiresAt);

  const headline =
    state === "expired"
      ? "Your suspension has ended"
      : state === "temporary-active"
        ? "Your HeartHaven account is temporarily suspended"
        : "Your HeartHaven account has been suspended";

  const description =
    state === "expired"
      ? "You can sign back in and return to HeartHaven."
      : state === "temporary-active"
        ? "Access will return automatically when the suspension lifts."
        : "This account is no longer permitted to access HeartHaven. The decision is final.";

  return (
    <main className="grid min-h-screen place-items-center bg-meadow p-6">
      <Card className="w-full max-w-xl bg-white/85">
        <CardHeader>
          <Logo className="mb-4" />
          <div className="flex items-center gap-3">
            <span
              className={`grid size-10 place-items-center rounded-full ${
                state === "expired"
                  ? "bg-garden-100 text-garden-700"
                  : state === "temporary-active"
                    ? "bg-honey-100 text-honey-700"
                    : "bg-blush-100 text-blush-600"
              }`}
            >
              {state === "expired" ? (
                <CheckCircle2 className="size-5" />
              ) : state === "temporary-active" ? (
                <Timer className="size-5" />
              ) : (
                <ShieldAlert className="size-5" />
              )}
            </span>
            <div>
              <CardTitle>{headline}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 text-sm leading-6 text-ink-700">
          {summary?.reason ? (
            <div
              className={`rounded-lg border p-4 font-semibold ${
                state === "expired"
                  ? "border-garden-300/40 bg-garden-100/60"
                  : state === "temporary-active"
                    ? "border-honey-300/40 bg-honey-100/60"
                    : "border-blush-300/40 bg-blush-100/60"
              }`}
            >
              <p
                className={`text-xs uppercase tracking-normal ${
                  state === "expired"
                    ? "text-garden-700"
                    : state === "temporary-active"
                      ? "text-honey-700"
                      : "text-blush-600"
                }`}
              >
                Reason on file
              </p>
              <p className="mt-1 text-ink-800">{summary.reason}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-ink-500">
                {issuedLabel && <span>Issued {issuedLabel}</span>}
                {state === "temporary-active" && expiresLabel && (
                  <span>Ends {expiresLabel}</span>
                )}
                {state === "expired" && expiresLabel && (
                  <span>Ended {expiresLabel}</span>
                )}
                {state === "permanent" && <span>Permanent</span>}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-cream-300 bg-cream-100/80 p-4 font-semibold">
              <p>
                Your access to HeartHaven has been revoked. If you provided an email at signup, a notice with the
                specific reason was sent to that address.
              </p>
            </div>
          )}

          {state !== "expired" && (
            <>
              <p>
                Bans are issued only when an account violates the HeartHaven community guidelines in a way that the
                moderation team has reviewed and confirmed. Creating new accounts to bypass this suspension is itself a
                violation and those accounts will be removed as they are discovered.
              </p>
              <p>
                If you believe this was issued in error, contact{" "}
                <a className="text-blush-600 underline" href="mailto:support@realfiction.store">
                  support@realfiction.store
                </a>{" "}
                from the email tied to this account. Include any context you think helps. We don&apos;t guarantee a
                response window.
              </p>
            </>
          )}

          <div className="flex flex-wrap gap-3">
            {state === "expired" ? (
              <Button asChild variant="warm">
                <Link href="/auth/sign-in">Sign back in</Link>
              </Button>
            ) : (
              <Button asChild variant="warm">
                <Link href="/">Back to landing</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
