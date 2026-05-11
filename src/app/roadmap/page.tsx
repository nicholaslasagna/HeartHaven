import Link from "next/link";
import { ArrowLeft, CheckCircle2, Circle, Database, Gamepad2, HeartHandshake, RadioTower, Sparkles } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const phases = [
  {
    title: "Phase 1",
    icon: Sparkles,
    status: "active",
    items: ["Landing", "Auth pages", "Profile creation", "Pet adoption", "Dashboard", "Room", "Garden", "Shop"],
  },
  {
    title: "Phase 2",
    icon: Database,
    status: "schema ready",
    items: ["Supabase schema", "RLS policies", "Persistent pets", "Inventory", "Wallets", "Furniture placement"],
  },
  {
    title: "Phase 3",
    icon: Gamepad2,
    status: "prototype ready",
    items: ["Phaser room renderer", "Avatar movement", "Pet sprite", "Clickable items", "Save/load placed items"],
  },
  {
    title: "Phase 4",
    icon: Gamepad2,
    status: "planned",
    items: ["Memory Match", "Garden Catch", "Rewards system"],
  },
  {
    title: "Phase 5",
    icon: HeartHandshake,
    status: "modeled",
    items: ["Friend codes", "Partner linking", "Shared garden", "Love notes", "Memory book"],
  },
  {
    title: "Phase 6",
    icon: RadioTower,
    status: "modeled",
    items: ["Presence", "Room invites", "Two avatars", "Emotes", "Realtime movement"],
  },
];

export default function RoadmapPage() {
  return (
    <main className="min-h-screen bg-paper px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-center justify-between">
          <Logo />
          <Button asChild variant="warm">
            <Link href="/">
              <ArrowLeft /> Back
            </Link>
          </Button>
        </div>
        <section className="mt-10 max-w-3xl">
          <Badge variant="blush">Implementation plan</Badge>
          <h1 className="mt-4 font-display text-5xl leading-tight text-ink-900">Build HeartHaven in durable phases.</h1>
          <p className="mt-4 text-base font-semibold leading-7 text-ink-700">
            The live app starts with Phase 1 screens, while the schema and component boundaries already support persistence, partner features, and multiplayer sessions.
          </p>
        </section>
        <section className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {phases.map((phase) => (
            <Card key={phase.title} className="bg-white/72">
              <CardHeader>
                <div className="mb-3 flex items-center justify-between">
                  <phase.icon className="size-6 text-blush-500" />
                  <Badge variant="outline">{phase.status}</Badge>
                </div>
                <CardTitle>{phase.title}</CardTitle>
                <CardDescription>{phase.items.length} implementation tracks</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {phase.items.map((item, index) => {
                  const done = phase.title === "Phase 1" || (phase.title === "Phase 2" && index < 2) || (phase.title === "Phase 3" && index < 4);

                  return (
                    <div key={item} className="flex items-center gap-2 text-sm font-bold text-ink-700">
                      {done ? <CheckCircle2 className="size-4 text-garden-500" /> : <Circle className="size-4 text-ink-500" />}
                      {item}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </main>
  );
}
