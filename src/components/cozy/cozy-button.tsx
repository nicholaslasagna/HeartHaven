import type { ButtonProps } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CozyButton({ className, variant = "default", ...props }: ButtonProps) {
  return (
    <Button
      variant={variant}
      className={cn("shadow-[0_10px_28px_-18px_rgba(91,63,63,0.55)]", className)}
      {...props}
    />
  );
}
