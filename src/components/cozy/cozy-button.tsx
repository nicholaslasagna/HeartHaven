import type { ButtonProps } from "@/components/ui/button";
import { Button } from "@/components/ui/button";

/**
 * CozyButton — a thin wrapper around `<Button>` so cozy-styled callsites
 * keep their imports unchanged. The actual cozy look is baked into the
 * shared `buttonVariants` now, so there's no overlay/shadow stack here.
 */
export function CozyButton({ className, variant = "default", ...props }: ButtonProps) {
  return <Button className={className} variant={variant} {...props} />;
}
