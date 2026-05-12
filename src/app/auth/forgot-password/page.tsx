import Link from "next/link";
import { ArrowRight, Home, Mail } from "lucide-react";
import { forgotPasswordAction } from "@/app/auth/actions";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;

  return (
    <main
      className="grid min-h-screen place-items-center bg-cover bg-center p-4"
      style={{ backgroundImage: "linear-gradient(rgba(253,248,238,0.76), rgba(253,248,238,0.9)), url('/auth-assets/cozy-security-gate.png')" }}
    >
      <Card className="w-full max-w-md bg-white/86">
        <CardHeader>
          <Logo className="mb-6" />
          <CardTitle>Reset password</CardTitle>
          <CardDescription>Send a secure recovery link to the email on your HeartHaven account.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {message && (
            <div className="rounded-lg border border-blush-300/40 bg-blush-100 p-3 text-sm font-bold text-ink-700">
              {message}
            </div>
          )}
          <form action={forgotPasswordAction} className="grid gap-4">
            <label className="grid gap-2 text-sm font-extrabold text-ink-700">
              Email
              <Input type="email" name="email" placeholder="you@example.com" required />
            </label>
            <Button>
              <Mail /> Send reset link <ArrowRight />
            </Button>
          </form>
          <div className="flex items-center justify-between text-sm font-bold text-ink-500">
            <Link href="/auth/sign-in">Back to sign in</Link>
            <Link href="/" className="inline-flex items-center gap-1">
              <Home className="size-3.5" /> Landing
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
