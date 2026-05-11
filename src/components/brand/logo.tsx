import Link from "next/link";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

type LogoProps = {
  compact?: boolean;
  className?: string;
};

export function Logo({ compact = false, className }: LogoProps) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2 text-ink-900", className)}>
      <span className="grid size-9 place-items-center rounded-full bg-blush-200 text-blush-500 shadow-sm">
        <Heart className="size-5 fill-current" />
      </span>
      {!compact && (
        <span className="font-display text-2xl leading-none">
          HeartHaven
        </span>
      )}
    </Link>
  );
}
