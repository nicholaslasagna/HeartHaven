import { ArrowRight, BadgeCheck } from "lucide-react";
import { createProfileAction } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ProfileForm() {
  return (
    <Card className="bg-white/78">
      <CardHeader>
        <CardTitle>Create your keeper profile</CardTitle>
        <CardDescription>Your username is public. Your display name stays private account context.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" action={createProfileAction}>
          <label className="grid gap-2 text-sm font-extrabold text-ink-700">
            Username shown in-game
            <Input name="username" placeholder="moonberrykeeper" pattern="[A-Za-z0-9_.-]{3,24}" />
          </label>
          <label className="grid gap-2 text-sm font-extrabold text-ink-700">
            Private display name
            <Input name="displayName" placeholder="Only visible in private account settings" />
          </label>
          <label className="grid gap-2 text-sm font-extrabold text-ink-700">
            Haven name
            <Input name="havenName" placeholder="Moonlit Meadow" />
          </label>
          <label className="grid gap-2 text-sm font-extrabold text-ink-700">
            Short mood note
            <Textarea name="bio" placeholder="What should your friends know when they visit?" />
          </label>
          <div className="rounded-lg border border-garden-300/40 bg-garden-100/70 p-4 text-sm text-garden-700">
            <div className="mb-1 flex items-center gap-2 font-extrabold">
              <BadgeCheck className="size-4" />
            Haven setup
            </div>
            This creates your keeper profile, starter room, garden, first inventory, room layout, and wallet.
          </div>
          <Button className="justify-self-start">
            Continue to adoption <ArrowRight />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
