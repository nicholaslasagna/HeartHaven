import Link from "next/link";
import { ArrowRight, Home } from "lucide-react";
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
      <section className="hidden items-end overflow-hidden p-10 md:flex">
        <div className="max-w-md pb-8 text-ink-900">
          <p className="font-display text-5xl leading-tight">Begin your haven</p>
          <p className="mt-4 text-base font-bold text-ink-700">Create the account that owns pets, rooms, gardens, and private memories.</p>
        </div>
      </section>
      <section className="flex items-center justify-center bg-cream-50/90 p-4">
        <Card className="w-full max-w-md bg-white/82">
          <CardHeader>
            <Logo className="mb-6" />
            <CardTitle>Create account</CardTitle>
            <CardDescription>Supabase Auth handles sessions and ownership for every game record.</CardDescription>
          </CardHeader>
          <CardContent>
            {message && (
              <div className="mb-4 rounded-lg border border-blush-300/40 bg-blush-100 p-3 text-sm font-bold text-ink-700">
                {message}
              </div>
            )}
            <form action={signUpAction} className="grid gap-4">
              <label className="grid gap-2 text-sm font-extrabold text-ink-700">
                Email
                <Input type="email" name="email" placeholder="you@example.com" required />
              </label>
              <label className="grid gap-2 text-sm font-extrabold text-ink-700">
                Password
                <Input type="password" name="password" minLength={8} required />
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
