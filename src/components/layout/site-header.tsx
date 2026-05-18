import Link from "next/link";
import { ArrowRight, UserRound } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

type SiteHeaderProps = {
  /** When true, swap auth CTAs for "Open your world" + account shortcut. */
  signedIn?: boolean;
};

export function SiteHeader({ signedIn = false }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-cream-300/60 bg-cream-50/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm font-extrabold text-ink-700 md:flex">
          {/* All zone links target /app/area?zone=X so switching modes
              stays inside the seamless AreaClient container (no shell
              remount, no audio/realtime tear-down). */}
          <Link href="/app/area?zone=room">Room</Link>
          <Link href="/app/area?zone=garden">Garden</Link>
          <Link href="/app/shop">Shop</Link>
          <Link href="/roadmap">Roadmap</Link>
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <>
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <Link href="/app/account">
                  <UserRound /> Account
                </Link>
              </Button>
              <Button asChild>
                <Link href="/app/area">
                  Open your world <ArrowRight />
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <Link href="/auth/sign-in">Sign in</Link>
              </Button>
              <Button asChild>
                <Link href="/auth/sign-up">
                  Begin <ArrowRight />
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
