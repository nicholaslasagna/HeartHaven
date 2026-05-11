import { ArrowRight, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ProfileForm() {
  return (
    <Card className="bg-white/78">
      <CardHeader>
        <CardTitle>Create your keeper profile</CardTitle>
        <CardDescription>Your public name, private preferences, and friend code live here.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" action="/onboarding/adopt-pet">
          <label className="grid gap-2 text-sm font-extrabold text-ink-700">
            Display name
            <Input name="displayName" placeholder="Avery" />
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
              Phase 2 ready
            </div>
            This form maps to <code>profiles</code>, <code>worlds</code>, <code>rooms</code>, <code>gardens</code>, and the starter wallet seed.
          </div>
          <Button className="justify-self-start">
            Continue to adoption <ArrowRight />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
