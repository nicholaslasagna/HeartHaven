/**
 * Shared sizing for on-screen game controls.
 *
 * Each game's pad used to size its own buttons, and all three ended up under
 * the minimum: the kart's were about 29px tall, HeartRush's and Lantern
 * Leap's about 38px — while a comment in the kart pad claimed they "stay
 * above the ~44px touch-target minimum". Nothing enforced it, so the claim
 * and the code drifted apart without anyone noticing.
 *
 * 44px is the figure both Apple's and Google's guidance land on, and it is
 * not cosmetic: a button smaller than a fingertip gets missed under pressure,
 * which in a racing game means a boost you meant to press and in a platformer
 * means a jump you did not make.
 */
export const TOUCH_TARGET_MIN_PX = 44;

/**
 * Size and hit-area for a control pad button. Colours stay with each game —
 * this only guarantees the button is big enough to hit.
 */
export const TOUCH_BUTTON_BASE =
  "pointer-events-auto select-none inline-flex items-center justify-center " +
  "min-h-[44px] min-w-[44px] rounded-full px-4 " +
  "text-[11px] font-black uppercase tracking-wide";
