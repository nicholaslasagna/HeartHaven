import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabaseConfig, isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Shown when the middleware detects a banned session and signs the keeper
 * out. The `ref` query param is the ban id; we read a PII-free summary
 * (`reason` + `created_at`) through the `get_ban_summary` RPC, which is
 * callable by anon by design — the page renders even after sign-out.
 *
 * If `ref` is missing or invalid we fall back to a generic notice. The
 * page intentionally exposes NO data beyond reason + timestamp.
 */
async function loadBanSummary(refRaw: string | undefined) {
  if (!refRaw) return null;
  if (!isSupabaseConfigured()) return null;
  // Loose UUID shape — the RPC will return zero rows for unknown ids
  // anyway, but rejecting obvious garbage early avoids a needless trip.
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
    const row = data[0] as { reason?: string; created_at?: string };
    return {
      reason: typeof row.reason === "string" ? row.reason : null,
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
    };
  } catch {
    return null;
  }
}

export default async function AccountSuspendedPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const summary = await loadBanSummary(ref);
  const dateLabel = summary?.createdAt
    ? new Date(summary.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <main className="grid min-h-screen place-items-center bg-meadow p-6">
      <Card className="w-full max-w-xl bg-white/85">
        <CardHeader>
          <Logo className="mb-4" />
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-blush-100 text-blush-600">
              <ShieldAlert className="size-5" />
            </span>
            <div>
              <CardTitle>Your HeartHaven account has been suspended</CardTitle>
              <CardDescription>
                This account is no longer permitted to access HeartHaven. The decision is final.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 text-sm leading-6 text-ink-700">
          {summary?.reason ? (
            <div className="rounded-lg border border-blush-300/40 bg-blush-100/60 p-4 font-semibold">
              <p className="text-xs uppercase tracking-normal text-blush-600">Reason on file</p>
              <p className="mt-1 text-ink-800">{summary.reason}</p>
              {dateLabel && (
                <p className="mt-2 text-xs font-bold text-ink-500">Issued {dateLabel}</p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-cream-300 bg-cream-100/80 p-4 font-semibold">
              <p>
                Your access to HeartHaven has been revoked. If you provided an email at signup, a notice with the
                specific reason was sent to that address.
              </p>
            </div>
          )}
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
          <Button asChild variant="warm" className="justify-self-start">
            <Link href="/">Back to landing</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
