import { KeyRound, LogOut, MailCheck, PhoneCall, ShieldCheck, Trash2 } from "lucide-react";
import { signOutAction, updatePasswordAction } from "@/app/auth/actions";
import { updatePhoneAction } from "@/app/(game)/app/account/account-actions";
import { MfaPanel } from "@/components/auth/mfa-panel";
import { CozyCard } from "@/components/cozy/cozy-card";
import { UsernameSettingsPanel } from "@/components/account/username-settings-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPhoneForDisplay } from "@/lib/auth/phone";
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
  let serverUsername: string | null = null;
  let serverUsernameHistory: string[] | null = null;
  let serverPhone: string | null = null;

  if (isSupabaseConfigured()) {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    email = user?.email ?? "HeartHaven keeper";
    confirmed = Boolean(user?.email_confirmed_at);

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, username_changes, phone")
        .eq("id", user.id)
        .maybeSingle();
      serverUsername = typeof profile?.username === "string" ? profile.username : null;
      serverUsernameHistory = Array.isArray(profile?.username_changes)
        ? (profile.username_changes as unknown[]).map((entry) => String(entry))
        : null;
      serverPhone = typeof profile?.phone === "string" ? profile.phone : null;
    }
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-cream-300 bg-white/70 p-5 shadow-sm">
        <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Keeper account</p>
        <h1 className="mt-1 font-display text-4xl text-ink-900">Username, sign-in, and security</h1>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-ink-700">
          Your username is what everyone sees in HeartHaven — chat, invites, the header, everywhere. Email stays
          private to you.
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

      <UsernameSettingsPanel serverHistory={serverUsernameHistory} serverUsername={serverUsername} />

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <CozyCard className="p-5">
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-500">
            <MailCheck className="size-4" /> Session email
          </p>
          <h2 className="mt-2 font-display text-2xl text-ink-900">{email}</h2>
          <p className="mt-2 text-sm font-bold text-ink-700">
            Email status: {confirmed ? "confirmed" : "not confirmed or unavailable in this build"}
          </p>
          <p className="mt-2 text-xs font-bold text-ink-500">
            Your email is only used to sign in and recover your account. It&apos;s never shown to other keepers.
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
          <h2 className="mt-2 font-display text-2xl text-ink-900">Change password</h2>
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

      <CozyCard className="p-5">
        <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-garden-700">
          <PhoneCall className="size-4" /> Phone (optional)
        </p>
        <h2 className="mt-2 font-display text-2xl text-ink-900">Recovery & safety phone</h2>
        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
          Optional. Used only to help recover your account and to keep banned users from
          returning under a new email. Never shown to other keepers. Format: international, like
          <code className="mx-1 rounded bg-cream-200 px-1 py-0.5">+14155550100</code>.
        </p>
        {serverPhone && (
          <p className="mt-3 text-sm font-bold text-ink-800">
            On file: <span className="font-extrabold">{formatPhoneForDisplay(serverPhone)}</span>
          </p>
        )}
        <form action={updatePhoneAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="grid gap-2 text-sm font-extrabold text-ink-700">
            {serverPhone ? "Replace phone" : "Add phone"}
            <Input
              type="tel"
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+1 415 555 0100"
              defaultValue={serverPhone ?? ""}
            />
          </label>
          <Button type="submit" name="intent" value="save">
            <ShieldCheck /> Save phone
          </Button>
          {serverPhone && (
            <Button type="submit" name="intent" value="clear" variant="secondary">
              <Trash2 /> Remove
            </Button>
          )}
        </form>
      </CozyCard>

      <MfaPanel />
    </div>
  );
}
