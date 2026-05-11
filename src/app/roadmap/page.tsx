import Link from "next/link";
import { ArrowLeft, BookHeart, CheckCircle2, Circle, Database, Gamepad2, HeartHandshake, RadioTower, Sparkles } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const phases = [
  {
    title: "Phase 1",
    icon: Sparkles,
    status: "live",
    items: [
      { label: "Landing", done: true },
      { label: "Auth pages", done: true },
      { label: "Profile creation", done: true },
      { label: "Pet adoption", done: true },
      { label: "Dashboard", done: true },
      { label: "Room", done: true },
      { label: "Garden", done: true },
      { label: "Shop", done: true },
    ],
  },
  {
    title: "Phase 2",
    icon: Database,
    status: "schema ready",
    items: [
      { label: "Supabase schema", done: true },
      { label: "RLS policies", done: true },
      { label: "Persistent pets", done: false },
      { label: "Inventory", done: false },
      { label: "Wallets", done: false },
      { label: "Furniture placement saves", done: false },
    ],
  },
  {
    title: "Phase 3",
    icon: Gamepad2,
    status: "playable room live",
    items: [
      { label: "2.5D Phaser room renderer", done: true },
      { label: "Click-to-move and WASD avatar", done: true },
      { label: "Casper pet behavior states", done: true },
      { label: "Clickable, draggable, rotatable furniture", done: true },
      { label: "Depth sorting, shadows, hover outlines", done: true },
      { label: "Save/load placed items", done: false },
    ],
  },
  {
    title: "Phase 4",
    icon: Gamepad2,
    status: "first game live",
    items: [
      { label: "Petal Catch playable mini-game", done: true },
      { label: "Score, timer, combo, difficulty curve", done: true },
      { label: "Rewards preview screen", done: true },
      { label: "Memory Match", done: false },
      { label: "Persistent rewards system", done: false },
    ],
  },
  {
    title: "Phase 5",
    icon: HeartHandshake,
    status: "shared garden live",
    items: [
      { label: "Friend codes", done: false },
      { label: "Partner linking", done: false },
      { label: "Playable shared garden", done: true },
      { label: "Love notes", done: true },
      { label: "Memory book", done: true },
    ],
  },
  {
    title: "Phase 6",
    icon: RadioTower,
    status: "planned",
    items: [
      { label: "Presence", done: false },
      { label: "Room invites", done: false },
      { label: "Two avatars", done: false },
      { label: "Emotes", done: false },
      { label: "Realtime movement", done: false },
    ],
  },
  {
    title: "Phase 7",
    icon: BookHeart,
    status: "private content live",
    items: [
      { label: "Nicholas & Gianna's Garden", done: true },
      { label: "Casper guardian statue", done: true },
      { label: "365 Saved Messages marker", done: true },
      { label: "Three Finals and a Thousand Prayers quest", done: true },
      { label: "Virtual Date That Felt Real quest", done: true },
      { label: "Almost Two Years quest", done: true },
      { label: "Private love note system shell", done: true },
    ],
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
            The app now has a real playable layer: a 2.5D Phaser room, a living garden, a shared memory garden,
            and Petal Catch. Persistence and multiplayer are intentionally next so the core feel can stay magical first.
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
                {phase.items.map((item) => {
                  return (
                    <div key={item.label} className="flex items-center gap-2 text-sm font-bold text-ink-700">
                      {item.done ? <CheckCircle2 className="size-4 text-garden-500" /> : <Circle className="size-4 text-ink-500" />}
                      {item.label}
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
