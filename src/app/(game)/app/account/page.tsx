import { KeyRound, LogOut, MailCheck, ShieldCheck } from "lucide-react";
import { signOutAction, updatePasswordAction } from "@/app/auth/actions";
import { MfaPanel } from "@/components/auth/mfa-panel";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseMissingConfigMessage, isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  let email = "Demo keeper";
  let confirmed = false;

  if (isSupabaseConfigured()) {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    email = user?.email ?? "HeartHaven keeper";
    confirmed = Boolean(user?.email_confirmed_at);
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-cream-300 bg-white/70 p-5 shadow-sm">
        <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Keeper account</p>
        <h1 className="mt-1 font-display text-4xl text-ink-900">Security and sign-in</h1>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-ink-700">
          Keep the session stable for rooms, parties, private memories, friend invites, and live multiplayer presence.
        </p>
      </section>

      {message && (
        <div className="rounded-lg border border-garden-300/50 bg-garden-100 p-4 text-sm font-black text-ink-800">
          {message}
        </div>
      )}

      {!isSupabaseConfigured() && (
        <div className="rounded-lg border border-honey-500/35 bg-honey-100/80 p-4 text-sm font-bold text-ink-800">
          {getSupabaseMissingConfigMessage()}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <CozyCard className="p-5">
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-500">
            <MailCheck className="size-4" /> Session
          </p>
          <h2 className="mt-2 font-display text-3xl text-ink-900">{email}</h2>
          <p className="mt-2 text-sm font-bold text-ink-700">
            Email status: {confirmed ? "confirmed" : "not confirmed or unavailable in demo mode"}
          </p>
          <form action={signOutAction} className="mt-5">
            <Button variant="secondary">
              <LogOut /> Sign out
            </Button>
          </form>
        </CozyCard>

        <CozyCard className="p-5">
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-honey-700">
            <KeyRound className="size-4" /> Password
          </p>
          <h2 className="mt-2 font-display text-3xl text-ink-900">Change password</h2>
          <form action={updatePasswordAction} className="mt-4 grid gap-3">
            <label className="grid gap-2 text-sm font-extrabold text-ink-700">
              New password
              <Input type="password" name="password" minLength={8} required />
            </label>
            <label className="grid gap-2 text-sm font-extrabold text-ink-700">
              Confirm password
              <Input type="password" name="confirmPassword" minLength={8} required />
            </label>
            <Button className="w-fit">
              <ShieldCheck /> Update password
            </Button>
          </form>
        </CozyCard>
      </div>

      <MfaPanel />
    </div>
  );
}
