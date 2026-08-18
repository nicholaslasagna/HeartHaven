import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. SERVER ONLY.
 *
 * The service role bypasses row-level security completely, so this key must
 * never reach a browser bundle. Next already refuses to inline env vars
 * without a NEXT_PUBLIC_ prefix, so the key cannot be bundled by accident;
 * the guard below is the second line of defence, turning a mistaken client
 * import into a loud failure instead of a silent `null` client that quietly
 * skips a ban check.
 *
 * Reach for this ONLY where a privileged action genuinely cannot be
 * expressed as an RLS policy or a SECURITY DEFINER function — today that
 * means ban checks that must not be exposed as an anonymous oracle.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  if (typeof window !== "undefined") {
    throw new Error("The Supabase admin client is server-only and must never be constructed in a browser.");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Missing config is normal in preview/demo deployments, so callers decide
  // how to degrade rather than this throwing at import time.
  if (!url || !serviceRole) return null;

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
