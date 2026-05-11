import { Coins, Heart } from "lucide-react";
import { cn } from "@/lib/utils";

type CurrencyPillProps = {
  type: "coins" | "hearts";
  value: number;
  className?: string;
};

export function CurrencyPill({ type, value, className }: CurrencyPillProps) {
  const isCoins = type === "coins";
  const Icon = isCoins ? Coins : Heart;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-extrabold shadow-sm",
        isCoins
          ? "border-honey-500/25 bg-honey-100 text-honey-700"
          : "border-blush-300/35 bg-blush-100 text-ink-700",
        className,
      )}
    >
      <Icon className={cn("size-4", !isCoins && "fill-current text-blush-500")} />
      {value.toLocaleString()}
    </span>
  );
}
