import type { HTMLAttributes } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CozyCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <Card
      className={cn(
        "border-cream-300/80 bg-white/75 shadow-[0_18px_40px_-26px_rgba(91,63,63,0.55)] backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}
