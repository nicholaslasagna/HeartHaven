"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
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
    return "Supabase is rate limiting this email for a moment. Wait a minute, then try again.";
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
  const origin = await getRequestOrigin();
  const supabase = await getSupabaseServerClient();
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
