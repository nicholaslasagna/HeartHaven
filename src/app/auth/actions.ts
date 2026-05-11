"use server";

import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function signInAction(formData: FormData) {
  if (!isSupabaseConfigured()) {
    redirect("/auth/sign-in?message=Supabase%20environment%20variables%20are%20not%20configured");
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/auth/sign-in?message=${encodeURIComponent(error.message)}`);
  }

  redirect("/app");
}

export async function signUpAction(formData: FormData) {
  if (!isSupabaseConfigured()) {
    redirect("/auth/sign-up?message=Supabase%20environment%20variables%20are%20not%20configured");
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect(`/auth/sign-up?message=${encodeURIComponent(error.message)}`);
  }

  redirect("/onboarding/profile");
}
