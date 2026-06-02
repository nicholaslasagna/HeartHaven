import Link from "next/link";
import { ArrowRight, Home, MailCheck } from "lucide-react";
import { signUpAction } from "@/app/auth/actions";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;

  return (
    <main className="grid min-h-screen bg-meadow md:grid-cols-[1.05fr_0.95fr]">
      <section
        className="relative hidden items-end overflow-hidden bg-cover bg-center p-10 md:flex"
        style={{ backgroundImage: "url('/auth-assets/cozy-security-gate.png')" }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-cream-100/95 via-cream-100/38 to-transparent" />
        <div className="relative max-w-md pb-8 text-ink-900">
          <p className="font-display text-5xl leading-tight">Begin your haven</p>
          <p className="mt-4 text-base font-bold text-ink-700">
            Create the account that owns pets, rooms, gardens, multiplayer sessions, and private memories.
          </p>
        </div>
      </section>
      <section className="flex items-center justify-center bg-cream-50/90 p-4">
        <Card className="w-full max-w-md bg-white/82">
          <CardHeader>
            <Logo className="mb-6" />
            <CardTitle>Create account</CardTitle>
            <CardDescription>HeartHaven keeps your session, email confirmation, and game ownership protected.</CardDescription>
          </CardHeader>
          <CardContent>
            {message && (
              <div className="mb-4 rounded-lg border border-blush-300/40 bg-blush-100 p-3 text-sm font-bold text-ink-700">
                {message}
              </div>
            )}
            <div className="mb-4 rounded-lg border border-honey-500/25 bg-honey-100/70 p-3 text-sm font-bold leading-6 text-ink-700">
              <MailCheck className="mr-2 inline size-4 text-honey-700" />
              If email confirmation is enabled, HeartHaven now waits for confirmation before sending you into onboarding.
            </div>
            <form action={signUpAction} className="grid gap-4">
              <label className="grid gap-2 text-sm font-extrabold text-ink-700">
                Email
                <Input type="email" name="email" placeholder="you@example.com" required />
              </label>
              <label className="grid gap-2 text-sm font-extrabold text-ink-700">
                Password
                <Input type="password" name="password" minLength={8} autoComplete="new-password" required />
              </label>
              <label className="grid gap-2 text-sm font-extrabold text-ink-700">
                Confirm password
                <Input type="password" name="confirmPassword" minLength={8} autoComplete="new-password" required />
              </label>
              <label className="grid gap-2 text-sm font-extrabold text-ink-700">
                Phone <span className="text-xs font-bold text-ink-500">(optional)</span>
                <Input
                  type="tel"
                  name="phone"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+1 415 555 0100"
                />
                <span className="text-xs font-bold leading-5 text-ink-500">
                  Helps recover your account and prevents banned users from re-joining under
                  a new email. Never shown to other keepers.
                </span>
              </label>
              <Button>
                Create account <ArrowRight />
              </Button>
            </form>
            <div className="mt-5 flex items-center justify-between text-sm font-bold text-ink-500">
              <Link href="/auth/sign-in">Already have one?</Link>
              <Link href="/" className="inline-flex items-center gap-1">
                <Home className="size-3.5" /> Landing
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
