import { BookHeart } from "lucide-react";
import { CozyCard } from "@/components/cozy/cozy-card";
import { cn } from "@/lib/utils";

type MemoryBookPageProps = {
  title: string;
  date: string;
  excerpt: string;
  tone: "blush" | "lavender" | "garden";
};

export function MemoryBookPage({ title, date, excerpt, tone }: MemoryBookPageProps) {
  const toneClass = {
    blush: "bg-blush-100 border-blush-300/40",
    lavender: "bg-lavender-100 border-lavender-300/50",
    garden: "bg-garden-100 border-garden-300/50",
  }[tone];

  return (
    <CozyCard className={cn("relative overflow-hidden p-5", toneClass)}>
      <BookHeart className="mb-6 size-7 text-ink-500" />
      <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">{date}</p>
      <h2 className="mt-2 font-display text-3xl leading-tight text-ink-900">{title}</h2>
      <p className="mt-4 text-sm font-semibold leading-6 text-ink-700">{excerpt}</p>
      <div className="absolute bottom-4 right-5 font-serif text-5xl italic text-white/65">hh</div>
    </CozyCard>
  );
}
