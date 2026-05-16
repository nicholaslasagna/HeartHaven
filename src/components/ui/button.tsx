import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group relative inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full text-sm font-extrabold outline-none transition-all duration-200 ease-out active:translate-y-px disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] [&_svg]:pointer-events-none [&_svg]:size-4",
  {
    variants: {
      variant: {
        default:
          "border border-blush-300/60 bg-gradient-to-b from-blush-400 to-blush-500 text-white shadow-[0_14px_32px_-18px_rgba(190,86,113,0.78),inset_0_1px_0_rgba(255,255,255,0.45)] hover:-translate-y-0.5 hover:from-blush-300 hover:to-blush-500 hover:shadow-[0_18px_38px_-20px_rgba(190,86,113,0.88),inset_0_1px_0_rgba(255,255,255,0.55)]",
        secondary:
          "border border-lavender-300/55 bg-gradient-to-b from-lavender-100/95 to-lavender-200/82 text-ink-800 shadow-[0_12px_28px_-20px_rgba(91,63,118,0.5),inset_0_1px_0_rgba(255,255,255,0.58)] hover:-translate-y-0.5 hover:from-lavender-100 hover:to-lavender-200",
        outline:
          "border border-cream-300/85 bg-white/62 text-ink-800 shadow-[0_12px_30px_-24px_rgba(91,63,63,0.42),inset_0_1px_0_rgba(255,255,255,0.66)] backdrop-blur hover:-translate-y-0.5 hover:border-blush-300/80 hover:bg-blush-50/82 hover:text-ink-900",
        ghost:
          "text-ink-700 hover:-translate-y-0.5 hover:bg-white/58 hover:text-ink-900 hover:shadow-[0_12px_24px_-22px_rgba(91,63,63,0.42)]",
        warm:
          "border border-honey-300/60 bg-gradient-to-b from-white/95 to-cream-100/92 text-ink-800 shadow-[0_12px_30px_-22px_rgba(152,104,38,0.45),inset_0_1px_0_rgba(255,255,255,0.72)] ring-1 ring-white/50 hover:-translate-y-0.5 hover:border-honey-300 hover:from-white hover:to-honey-100/60",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 px-4",
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
