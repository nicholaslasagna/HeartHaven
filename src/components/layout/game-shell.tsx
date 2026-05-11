import Link from "next/link";
import { BookHeart, Gamepad2, HeartHandshake, Home, Inbox, Leaf, Package, ShoppingBag, UserRound } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/app", label: "Home", icon: Home },
  { href: "/app/room", label: "Room", icon: Home },
  { href: "/app/garden", label: "Garden", icon: Leaf },
  { href: "/app/partner-garden", label: "Partner", icon: HeartHandshake },
  { href: "/app/games", label: "Games", icon: Gamepad2 },
  { href: "/app/memory-match", label: "Memory Match", icon: Gamepad2 },
  { href: "/app/petal-catch", label: "Petal Catch", icon: Gamepad2 },
  { href: "/app/bowling", label: "Bowling", icon: Gamepad2 },
  { href: "/app/lantern-relay", label: "Lantern Relay", icon: Gamepad2 },
  { href: "/app/heart-hunt", label: "Heart Hunt", icon: Gamepad2 },
  { href: "/app/shop", label: "Shop", icon: ShoppingBag },
  { href: "/app/inventory", label: "Inventory", icon: Package },
  { href: "/app/mailbox", label: "Mailbox", icon: Inbox },
  { href: "/app/memory-book", label: "Memory Book", icon: BookHeart },
];

export function GameShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper text-foreground">
      <header className="sticky top-0 z-40 border-b border-cream-300/60 bg-cream-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Logo />
          <div className="hidden items-center gap-2 xl:flex">
            <RewardWalletPanel compact />
            <Button variant="warm" size="sm">
              <UserRound /> Keeper
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:px-8 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-24 xl:h-[calc(100vh-7rem)]">
          <nav className="flex gap-2 overflow-x-auto rounded-lg border border-cream-300/70 bg-white/60 p-2 shadow-sm xl:flex-col xl:overflow-visible">
            {navItems.map((item) => (
              <Link
                href={item.href}
                key={item.href}
                className={cn(
                  "inline-flex min-w-fit items-center gap-2 rounded-md px-3 py-2 text-sm font-extrabold text-ink-700 transition-colors hover:bg-blush-100",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
