import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-cream-300/60 bg-cream-50/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm font-extrabold text-ink-700 md:flex">
          <Link href="/app/room">Room</Link>
          <Link href="/app/garden">Garden</Link>
          <Link href="/app/shop">Shop</Link>
          <Link href="/roadmap">Roadmap</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <Link href="/auth/sign-in">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/auth/sign-up">
              Begin <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
