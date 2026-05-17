import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Internal endpoint. Triggered by the admin from the BAN_RUNBOOK after a
 * `ban_keeper(...)` call returns a ban id:
 *
 *   curl -X POST https://realfiction.store/api/internal/send-ban-email \
 *     -H "x-internal-secret: $INTERNAL_WEBHOOK_SECRET" \
 *     -H "content-type: application/json" \
 *     -d '{"banId":"<uuid-from-ban_keeper>"}'
 *
 * The route:
 *   1. Verifies a shared-secret header. NO other auth — the only caller
 *      is the admin via curl. This is intentionally NOT reachable from
 *      the app's authenticated session.
 *   2. Uses the SERVICE-ROLE supabase client to read the permanent_bans
 *      row by id. The row contains the banned email + the user-facing
 *      reason.
 *   3. Sends a transactional email via Resend.
 *   4. Stamps email_sent_at + email_message_id back on the ban row via
 *      `mark_ban_email_sent(...)`.
 *
 * Idempotent — calling twice for the same banId sends two emails. The
 * admin only fires it once per ban; if Resend rejects, retry manually.
 */

const INTERNAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM_ADDRESS ?? "HeartHaven Safety <safety@realfiction.store>";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

type BanRow = {
  id: string;
  banned_email: string;
  reason: string;
  banned_friend_code: string;
  created_at: string;
};

function unauthorized() {
  // Generic 404 instead of 401 so the route doesn't advertise its
  // existence to drive-by scanners. The admin knows the path; nobody
  // else should be probing this.
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function renderEmail(row: BanRow) {
  const subject = "Your HeartHaven account has been suspended";
  const dateLabel = new Date(row.created_at).toUTCString();
  const text = [
    "Hello,",
    "",
    "We're writing to let you know that your HeartHaven account has been permanently",
    "suspended following a review of activity tied to it.",
    "",
    `Reason: ${row.reason}`,
    "",
    `Issued: ${dateLabel}`,
    "",
    "This decision is final. Creating new accounts to circumvent this suspension is",
    "itself a violation of our community guidelines, and any such accounts will be",
    "removed as they are discovered.",
    "",
    "If you believe this was issued in error, you may reply to this email with any",
    "context you think helps. We don't guarantee a response window.",
    "",
    "— The HeartHaven team",
    "https://realfiction.store",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #3a2a2a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h1 style="font-size: 22px; color: #b34a5f;">Your HeartHaven account has been suspended</h1>
  <p>Hello,</p>
  <p>We&rsquo;re writing to let you know that your HeartHaven account has been <strong>permanently suspended</strong> following a review of activity tied to it.</p>
  <div style="background: #fbe9ec; border: 1px solid #f0c4cb; border-radius: 8px; padding: 14px 16px; margin: 18px 0;">
    <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #b34a5f;">Reason on file</p>
    <p style="margin: 6px 0 0;"><strong>${escapeHtml(row.reason)}</strong></p>
    <p style="margin: 8px 0 0; font-size: 12px; color: #7c5a5a;">Issued ${escapeHtml(dateLabel)}</p>
  </div>
  <p>This decision is final. Creating new accounts to circumvent this suspension is itself a violation of our community guidelines, and any such accounts will be removed as they are discovered.</p>
  <p>If you believe this was issued in error, you may reply to this email with any context you think helps. We don&rsquo;t guarantee a response window.</p>
  <p style="margin-top: 28px; color: #7c5a5a;">&mdash; The HeartHaven team<br /><a href="https://realfiction.store" style="color: #b34a5f;">realfiction.store</a></p>
</body></html>`;

  return { subject, text, html };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(request: Request) {
  if (!INTERNAL_SECRET || !RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "server not configured for ban email dispatch" },
      { status: 500 },
    );
  }

  const provided = request.headers.get("x-internal-secret") ?? "";
  if (!timingSafeEqual(provided, INTERNAL_SECRET)) {
    return unauthorized();
  }

  let payload: { banId?: string };
  try {
    payload = (await request.json()) as { banId?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const banId = payload.banId;
  if (!banId || !/^[0-9a-fA-F-]{30,40}$/.test(banId)) {
    return NextResponse.json({ error: "banId is required" }, { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: row, error } = await admin
    .from("permanent_bans")
    .select("id, banned_email, reason, banned_friend_code, created_at, email_sent_at")
    .eq("id", banId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "ban not found" }, { status: 404 });
  }
  if (row.email_sent_at) {
    return NextResponse.json(
      { ok: true, alreadySent: true, sentAt: row.email_sent_at },
      { status: 200 },
    );
  }

  const banRow: BanRow = {
    id: row.id,
    banned_email: row.banned_email,
    reason: row.reason,
    banned_friend_code: row.banned_friend_code,
    created_at: row.created_at,
  };
  const { subject, text, html } = renderEmail(banRow);

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [banRow.banned_email],
      subject,
      text,
      html,
    }),
  });

  if (!resendResponse.ok) {
    const errorBody = await resendResponse.text().catch(() => "");
    return NextResponse.json(
      { error: "resend rejected", status: resendResponse.status, body: errorBody.slice(0, 500) },
      { status: 502 },
    );
  }

  const resendJson = (await resendResponse.json().catch(() => null)) as { id?: string } | null;
  const messageId = resendJson?.id ?? null;

  await admin.rpc("mark_ban_email_sent", { p_ban_id: banId, p_message_id: messageId ?? "" });

  return NextResponse.json({ ok: true, messageId }, { status: 200 });
}

// Block GET/other verbs so a curious crawler doesn't probe the route's
// behaviour by accident. The 404 keeps the path quiet.
export async function GET() {
  return unauthorized();
}
