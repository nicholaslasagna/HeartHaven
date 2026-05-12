import Link from "next/link";
import { ArrowRight, Home, KeyRound, Mail, WandSparkles } from "lucide-react";
import { magicLinkAction, signInAction } from "@/app/auth/actions";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;

  return (
    <main className="grid min-h-screen bg-sunset md:grid-cols-[1.05fr_0.95fr]">
      <section
        className="relative hidden items-end overflow-hidden bg-cover bg-center p-10 text-white md:flex"
        style={{ backgroundImage: "url('/auth-assets/cozy-security-gate.png')" }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900/62 via-ink-900/18 to-transparent" />
        <div className="relative max-w-md pb-8">
          <p className="font-serif text-3xl italic leading-tight drop-shadow">The lanterns are lit. Your companion is waiting.</p>
          <p className="mt-4 text-sm font-bold opacity-85">Return by password or magic link. HeartHaven keeps your room session warm across visits.</p>
        </div>
      </section>
      <section className="flex items-center justify-center bg-cream-50/95 p-4">
        <Card className="w-full max-w-md bg-white/86">
          <CardHeader>
            <Logo className="mb-6" />
            <CardTitle>Welcome home</CardTitle>
            <CardDescription>Sign in to continue building your haven, rooms, games, and shared memories.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {message && (
              <div className="mb-4 rounded-lg border border-blush-300/40 bg-blush-100 p-3 text-sm font-bold text-ink-700">
                {message}
              </div>
            )}
            <form action={signInAction} className="grid gap-4">
              <label className="grid gap-2 text-sm font-extrabold text-ink-700">
                Email
                <Input type="email" name="email" placeholder="you@example.com" required />
              </label>
              <label className="grid gap-2 text-sm font-extrabold text-ink-700">
                Password
                <Input type="password" name="password" required />
              </label>
              <Button className="w-full">
                <KeyRound /> Sign in <ArrowRight />
              </Button>
            </form>
            <div className="rounded-lg border border-lavender-200 bg-lavender-100/55 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-black text-ink-900">
                <WandSparkles className="size-4 text-lavender-500" /> Passwordless entry
              </p>
              <form action={magicLinkAction} className="grid gap-3">
                <Input type="email" name="email" placeholder="you@example.com" required />
                <Button variant="warm" className="w-full">
                  <Mail /> Send magic link
                </Button>
              </form>
            </div>
            <div className="flex items-center justify-between text-sm font-bold text-ink-500">
              <Link href="/auth/sign-up">Create an account</Link>
              <Link href="/auth/forgot-password">Forgot password?</Link>
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
