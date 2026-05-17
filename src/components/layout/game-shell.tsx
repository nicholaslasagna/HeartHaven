import Link from "next/link";
import { Gamepad2, HeartHandshake, Home, Inbox, Megaphone, Package, PawPrint, ShieldCheck, ShoppingBag, Users } from "lucide-react";
import { BanWatchdog } from "@/components/auth/ban-watchdog";
import { Logo } from "@/components/brand/logo";
import { AnnouncementsLoginToast } from "@/components/game/announcements-login-toast";
import { BanNotificationsHost } from "@/components/game/ban-notifications-host";
import { CozyAudioDock } from "@/components/game/cozy-audio-dock";
import { PartyFollowToast } from "@/components/game/party-follow-toast";
import { RewardToastHost } from "@/components/game/reward-toast-host";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { AnnouncementsNavBadge } from "@/components/layout/announcements-nav-badge";
import { KeeperAccountButton } from "@/components/layout/keeper-account-button";
import { SeasonalEventPill } from "@/components/seasonal/seasonal-event-pill";
import { ThemeModeDock } from "@/components/theme/theme-mode-dock";
import { cn } from "@/lib/utils";

const navItems: Array<{ href: string; label: string; icon: typeof Home; badge?: "announcements" }> = [
  { href: "/app/area", label: "World", icon: Home },
  { href: "/app/pet", label: "Studio", icon: PawPrint },
  { href: "/app/partner-garden", label: "Partner", icon: HeartHandshake },
  { href: "/app/friends", label: "Friends", icon: Users },
  { href: "/app/games", label: "Games", icon: Gamepad2 },
  { href: "/app/shop", label: "Shop", icon: ShoppingBag },
  { href: "/app/inventory", label: "Inventory", icon: Package },
  { href: "/app/mailbox", label: "Mailbox", icon: Inbox },
  // Memory Book route now houses dev-managed announcements + reward
  // claims. Path is kept on `/app/memory-book` so existing bookmarks +
  // analytics survive — only the label and badge are new.
  { href: "/app/memory-book", label: "Announcements", icon: Megaphone, badge: "announcements" },
  { href: "/app/account", label: "Account", icon: ShieldCheck },
];

export function GameShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper text-foreground">
      <header className="sticky top-0 z-40 border-b border-cream-300/60 bg-cream-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Logo />
          <div className="hidden items-center gap-2 xl:flex">
            <SeasonalEventPill />
            <ThemeModeDock />
            <CozyAudioDock />
            <RewardWalletPanel compact />
            <KeeperAccountButton />
          </div>
          <div className="xl:hidden">
            <div className="flex items-center gap-2">
              <SeasonalEventPill className="hidden sm:inline-flex" />
              <ThemeModeDock />
              <CozyAudioDock />
            </div>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1480px] gap-5 overflow-hidden px-4 py-5 sm:px-6 lg:px-8 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="min-w-0 xl:sticky xl:top-24 xl:h-[calc(100vh-7rem)]">
          <nav className="flex max-w-full gap-2 overflow-x-auto rounded-lg border border-cream-300/70 bg-white/60 p-2 shadow-sm xl:flex-col xl:overflow-visible">
            {navItems.map((item) => (
              <Link
                href={item.href}
                key={item.href}
                className={cn(
                  "inline-flex min-w-fit items-center gap-2 rounded-md px-3 py-2 text-sm font-extrabold text-ink-700 transition-colors hover:bg-blush-100",
                )}
              >
                <item.icon className="size-4" />
                <span>{item.label}</span>
                {item.badge === "announcements" && <AnnouncementsNavBadge />}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 max-w-full overflow-x-hidden">{children}</main>
      </div>
      <RewardToastHost />
      <PartyFollowToast />
      <AnnouncementsLoginToast />
      <BanNotificationsHost />
      <BanWatchdog />
    </div>
  );
}
