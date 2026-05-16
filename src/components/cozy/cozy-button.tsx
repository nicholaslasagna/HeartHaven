import type { ButtonProps } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CozyButton({ className, variant = "default", ...props }: ButtonProps) {
  return (
    <Button
      variant={variant}
      className={cn(
        "shadow-[0_14px_34px_-22px_rgba(91,63,63,0.55)] before:absolute before:inset-x-4 before:top-1 before:h-px before:bg-white/42 before:content-['']",
        className,
      )}
      {...props}
    />
  );
}
