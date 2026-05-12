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
      { label: "Date-based holiday events", done: true },
    ],
  },
  {
    title: "Phase 2",
    icon: Database,
    status: "schema + local state ready",
    items: [
      { label: "Supabase schema", done: true },
      { label: "RLS policies", done: true },
      { label: "Game session schema", done: true },
      { label: "Reward event schema", done: true },
      { label: "Seasonal catalog seed data", done: true },
      { label: "Local wallet rewards", done: true },
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
      { label: "Companion behavior states", done: true },
      { label: "Clickable, draggable, rotatable furniture", done: true },
      { label: "Depth sorting, shadows, hover outlines", done: true },
      { label: "Local save/load placed items", done: true },
      { label: "Supabase save/load placed items", done: false },
    ],
  },
  {
    title: "Phase 4",
    icon: Gamepad2,
    status: "game arcade live",
    items: [
      { label: "Petal Catch playable mini-game", done: true },
      { label: "Score, timer, combo, difficulty curve", done: true },
      { label: "Wallet reward payouts", done: true },
      { label: "Memory Match", done: true },
      { label: "Moonberry Bowling", done: true },
      { label: "Lantern Relay", done: true },
      { label: "Heart Hunt", done: true },
      { label: "Couple-vs-couple mode", done: true },
      { label: "Party pass-and-play mode", done: true },
      { label: "Server-validated rewards", done: false },
    ],
  },
  {
    title: "Phase 5",
    icon: HeartHandshake,
    status: "shared garden live",
    items: [
      { label: "Friend and party invite code shells", done: true },
      { label: "Partner linking", done: false },
      { label: "Playable shared garden", done: true },
      { label: "Love notes", done: true },
      { label: "Memory book", done: true },
      { label: "Games hub", done: true },
    ],
  },
  {
    title: "Phase 6",
    icon: RadioTower,
    status: "party shell ready",
    items: [
      { label: "Local party seats", done: true },
      { label: "Host lobby shell", done: true },
      { label: "Game session tables", done: true },
      { label: "Party mini-game routes", done: true },
      { label: "Presence", done: false },
      { label: "Online room invites", done: false },
      { label: "Two avatars", done: false },
      { label: "Emotes", done: false },
      { label: "Realtime movement", done: false },
    ],
  },
  {
    title: "Phase 7",
    icon: BookHeart,
    status: "private content gated",
    items: [
      { label: "Private couple garden entitlement", done: true },
      { label: "Private story payload table", done: true },
      { label: "Casper public companion content", done: true },
      { label: "Private garden guardian unlock path", done: true },
      { label: "Message Milestone marker", done: true },
      { label: "Study Week quest", done: true },
      { label: "Shared Visit quest", done: true },
      { label: "Milestone quest", done: true },
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
            Petal Catch, Memory Match, Moonberry Bowling, Lantern Relay, Heart Hunt, and local wallet rewards.
            Supabase tables are ready for protected persistence and realtime sessions.
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
