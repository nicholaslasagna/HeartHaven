import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// All buttons share the same shape (pill, bold weight, single transition,
// 1.5px-stroke focus ring). Variants only differ in fill + the colour of
// the "hard" bottom shadow that gives every button a Webkinz-style press
// affordance. This replaces the previous mix of soft-drop-shadow stacks
// that read inconsistently from screen to screen.
const buttonVariants = cva(
  "group relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-extrabold tracking-[0.01em] outline-none transition-[transform,box-shadow,background-color] duration-150 ease-out hover:-translate-y-px active:translate-y-[1px] active:shadow-[0_2px_0_var(--btn-shadow,#b66672)] disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 [&_svg]:pointer-events-none [&_svg]:size-4",
  {
    variants: {
      variant: {
        // Primary — the warm-pink call-to-action used everywhere a button
        // is THE action. Flat gradient, hard 4px bottom shadow, soft drop.
        default:
          "[--btn-shadow:#b66672] bg-gradient-to-b from-[#F4B5BE] to-[#E08894] text-white shadow-[0_4px_0_var(--btn-shadow),0_10px_22px_-8px_rgba(180,80,90,0.5)] text-shadow-[0_1px_0_rgba(140,60,70,0.3)] hover:from-[#F8C2C9] hover:to-[#E08894]",
        // Secondary — lavender, used for "alternative" CTAs.
        secondary:
          "[--btn-shadow:#7656a1] bg-gradient-to-b from-[#EFE6F7] to-[#DDCEEC] text-ink-800 shadow-[0_4px_0_var(--btn-shadow),0_10px_20px_-10px_rgba(110,78,160,0.45)] hover:from-[#F4ECFA] hover:to-[#DDCEEC]",
        // Outline — quiet button for less-emphatic actions. Soft cream
        // surface with a thin border, no hard shadow.
        outline:
          "border border-cream-300/85 bg-white/82 text-ink-800 shadow-[0_2px_0_rgba(180,158,148,0.18),0_6px_18px_-10px_rgba(91,63,63,0.28)] hover:border-blush-300/80 hover:bg-blush-50",
        // Ghost — text-only, used for inline links inside dense UI.
        ghost:
          "text-ink-700 hover:bg-white/72 hover:text-ink-900",
        // Warm — honey-toned, used as the friendly "share" button.
        warm:
          "[--btn-shadow:#c98a2b] bg-gradient-to-b from-[#FFF6DF] to-[#F8DC9B] text-ink-900 shadow-[0_4px_0_var(--btn-shadow),0_10px_22px_-10px_rgba(180,130,40,0.4)] hover:from-[#FFFBEE] hover:to-[#F8DC9B]",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 px-4 text-[13px]",
        lg: "h-12 px-6 text-base",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
