"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { normalizePhone } from "@/lib/auth/phone";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseMissingConfigMessage, isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

function normalizeEmail(formData: FormData) {
  return String(formData.get("email") ?? "").trim().toLowerCase();
}

function redirectWithMessage(path: string, message: string): never {
  redirect(`${path}?message=${encodeURIComponent(message)}`);
}

async function getRequestOrigin() {
  const headerStore = await headers();
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL;

  if (configuredOrigin) {
    return configuredOrigin.replace(/\/$/, "");
  }

  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const protocol = headerStore.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");

  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

function friendlyAuthMessage(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login") || normalized.includes("invalid credentials")) {
    return "Those credentials did not work. Check the email/password, confirm the email if this account is new, or use a magic link.";
  }

  if (normalized.includes("email not confirmed")) {
    return "That email is not confirmed yet. Open the confirmation email or send yourself a magic link.";
  }

  if (normalized.includes("rate limit")) {
    return "The sign-in service is slowing requests for this email for a moment. Wait a minute, then try again.";
  }

  return message;
}

function requireSupabase(path: string): void {
  if (!isSupabaseConfigured()) {
    redirectWithMessage(path, getSupabaseMissingConfigMessage());
  }
}

export async function signInAction(formData: FormData) {
  requireSupabase("/auth/sign-in");

  const email = normalizeEmail(formData);
  const password = String(formData.get("password") ?? "");
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirectWithMessage("/auth/sign-in", friendlyAuthMessage(error.message));
  }

  redirect("/app/area");
}

export async function signUpAction(formData: FormData) {
  requireSupabase("/auth/sign-up");

  const email = normalizeEmail(formData);
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) {
    redirectWithMessage("/auth/sign-up", "Use at least 8 characters for your password.");
  }

  if (password !== confirmPassword) {
    redirectWithMessage("/auth/sign-up", "The passwords did not match. Type it twice so your first login works later.");
  }

  // Phone is optional. When provided it MUST normalize to E.164 — the
  // shape check on the profiles table will reject otherwise, so we fail
  // up-front with a friendly message instead of letting the DB write fail
  // mid-onboarding.
  const phoneResult = normalizePhone(formData.get("phone")?.toString() ?? null);
  if (!phoneResult.ok) {
    redirectWithMessage("/auth/sign-up", phoneResult.reason);
  }
  const phone = "phone" in phoneResult ? phoneResult.phone : null;

  const origin = await getRequestOrigin();
  const supabase = await getSupabaseServerClient();

  /* Door-step ban gate.
     Run with the SERVICE ROLE, not the caller's anon session. The generic
     response copy below stops the sign-up FORM leaking which identifier
     matched, but that was only ever half the story: while the underlying
     RPCs were granted to `anon`, an attacker could skip the form entirely
     and call `is_email_banned` / `is_phone_banned` directly to test any
     address or number they liked. Migration 0082 revokes those grants, so
     the check now has to run from a trusted server context — here.

     Missing service-role config (preview and demo deployments) yields a null
     client and the gate opens. That is deliberate: this is a courtesy
     message, and the real enforcement is the ban check in proxy.ts, which
     redirects a banned session to /account-suspended on every request. */
  const admin = getSupabaseAdminClient();
  const [emailBan, phoneBan] = admin
    ? await Promise.all([
        admin.rpc("is_email_banned", { p_email: email }),
        phone
          ? admin.rpc("is_phone_banned", { p_phone: phone })
          : Promise.resolve({ data: false, error: null }),
      ])
    : [{ data: false, error: null }, { data: false, error: null }];
  if (emailBan.data === true || phoneBan.data === true) {
    redirectWithMessage(
      "/auth/sign-up",
      "This account cannot be created. If you believe this is in error, contact support@realfiction.store.",
    );
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding/profile`,
    },
  });

  if (error) {
    redirectWithMessage("/auth/sign-up", friendlyAuthMessage(error.message));
  }

  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    redirectWithMessage(
      "/auth/sign-in",
      "An account already exists for that email. Sign in, use a magic link, or reset the password if you do not remember it.",
    );
  }

  // Persist the optional phone onto the new profile row. The trigger that
  // creates profiles on auth.users insert already populated the base row,
  // so we just patch our column in. Failure here is non-fatal — phone is
  // optional and the account can still be used without it.
  if (phone && data.user) {
    await supabase.from("profiles").update({ phone }).eq("id", data.user.id);
  }

  if (!data.session) {
    redirectWithMessage(
      "/auth/sign-in",
      "Check your email to confirm the account, then come back through the HeartHaven sign-in page.",
    );
  }

  redirect("/onboarding/profile");
}

export async function magicLinkAction(formData: FormData) {
  requireSupabase("/auth/sign-in");

  const email = normalizeEmail(formData);
  const origin = await getRequestOrigin();
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/callback?next=/app/area`,
    },
  });

  if (error) {
    redirectWithMessage("/auth/sign-in", friendlyAuthMessage(error.message));
  }

  redirectWithMessage("/auth/sign-in", "Magic link sent. Open it on this device to enter HeartHaven.");
}

export async function forgotPasswordAction(formData: FormData) {
  requireSupabase("/auth/forgot-password");

  const email = normalizeEmail(formData);
  const origin = await getRequestOrigin();
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/auth/update-password`,
  });

  if (error) {
    redirectWithMessage("/auth/forgot-password", friendlyAuthMessage(error.message));
  }

  redirectWithMessage("/auth/sign-in", "Password reset link sent. Open the email to choose a new password.");
}

export async function updatePasswordAction(formData: FormData) {
  requireSupabase("/auth/update-password");

  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) {
    redirectWithMessage("/auth/update-password", "Use at least 8 characters for the new password.");
  }

  if (password !== confirmPassword) {
    redirectWithMessage("/auth/update-password", "The passwords did not match.");
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirectWithMessage("/auth/update-password", friendlyAuthMessage(error.message));
  }

  redirectWithMessage("/app/account", "Password changed. Your HeartHaven account is secure.");
}

export async function signOutAction() {
  requireSupabase("/auth/sign-in");

  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
