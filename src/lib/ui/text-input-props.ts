/**
 * Keyboard behaviour for fields where the phone's helpfulness gets in the way.
 *
 * A mobile browser assumes it is helping: it capitalises the first letter,
 * autocorrects what looks like a typo, and underlines what is not a word.
 * For prose that is right. For a friend code, a redemption code or a
 * username it is wrong, and autocorrect substituting a token is a failure
 * the player cannot see — the field looks like what they typed until it is
 * submitted and rejected.
 *
 * None of this shows up on a desktop browser, which is why it is centralised
 * here and asserted rather than left to each field.
 */

/** Codes: uppercase, never corrected, never suggested. */
export const CODE_INPUT_PROPS = {
  autoCapitalize: "characters",
  autoComplete: "off",
  autoCorrect: "off",
  spellCheck: false,
} as const;

/** Usernames are lowercase by convention and must not be "corrected". */
export const USERNAME_INPUT_PROPS = {
  autoCapitalize: "none",
  autoComplete: "username",
  autoCorrect: "off",
  spellCheck: false,
} as const;

/** One-time codes, so the keyboard offers the code instead of the alphabet. */
export const OTP_INPUT_PROPS = {
  autoComplete: "one-time-code",
  autoCorrect: "off",
  inputMode: "numeric",
  spellCheck: false,
} as const;

/**
 * A field that takes either a code or a full invite link. Case is left alone
 * here — the component folds it only once it knows which one it has.
 */
export const CODE_OR_LINK_INPUT_PROPS = {
  autoCapitalize: "none",
  autoComplete: "off",
  autoCorrect: "off",
  spellCheck: false,
} as const;
