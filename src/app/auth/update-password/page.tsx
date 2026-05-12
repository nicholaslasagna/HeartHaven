import Link from "next/link";
import { KeyRound } from "lucide-react";
import { updatePasswordAction } from "@/app/auth/actions";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;

  return (
    <main
      className="grid min-h-screen place-items-center bg-cover bg-center p-4"
      style={{ backgroundImage: "linear-gradient(rgba(253,248,238,0.72), rgba(228,239,215,0.9)), url('/auth-assets/cozy-security-gate.png')" }}
    >
      <Card className="w-full max-w-md bg-white/86">
        <CardHeader>
          <Logo className="mb-6" />
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>Your reset link opened a secure session. Set the new password below.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {message && (
            <div className="rounded-lg border border-blush-300/40 bg-blush-100 p-3 text-sm font-bold text-ink-700">
              {message}
            </div>
          )}
          <form action={updatePasswordAction} className="grid gap-4">
            <label className="grid gap-2 text-sm font-extrabold text-ink-700">
              New password
              <Input type="password" name="password" minLength={8} required />
            </label>
            <label className="grid gap-2 text-sm font-extrabold text-ink-700">
              Confirm password
              <Input type="password" name="confirmPassword" minLength={8} required />
            </label>
            <Button>
              <KeyRound /> Change password
            </Button>
          </form>
          <Link href="/auth/sign-in" className="text-sm font-bold text-ink-500">
            Return to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
