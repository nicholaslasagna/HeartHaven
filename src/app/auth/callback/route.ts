import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const otpTypes = new Set(["signup", "invite", "magiclink", "recovery", "email", "email_change"]);

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = requestUrl.searchParams.get("next") ?? "/app";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  const successUrl = new URL(safeNext, requestUrl.origin);
  const errorUrl = new URL("/auth/sign-in", requestUrl.origin);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");

  if (!isSupabaseConfigured()) {
    errorUrl.searchParams.set("message", "Supabase is not configured for this deployment.");
    return NextResponse.redirect(errorUrl);
  }

  const supabase = await getSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(successUrl);
    errorUrl.searchParams.set("message", error.message);
    return NextResponse.redirect(errorUrl);
  }

  if (tokenHash && type && otpTypes.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });

    if (!error) return NextResponse.redirect(successUrl);
    errorUrl.searchParams.set("message", error.message);
    return NextResponse.redirect(errorUrl);
  }

  errorUrl.searchParams.set("message", "The auth link was missing a valid Supabase code. Request a new link and try again.");
  return NextResponse.redirect(errorUrl);
}
