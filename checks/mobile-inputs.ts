/**
 * Mobile keyboard behaviour check.
 *
 *   npm run check:mobile-inputs
 *
 * None of this is visible on a desktop browser, which is exactly why it
 * needs asserting. A phone assumes it is helping: it capitalises the first
 * letter, autocorrects what looks like a typo, and suggests completions. For
 * prose that is right; for a friend code or a username it silently corrupts
 * what the player typed, and they cannot see it happen.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { looksLikeInviteLink } from "../src/lib/game/social";
import {
  CODE_INPUT_PROPS,
  CODE_OR_LINK_INPUT_PROPS,
  OTP_INPUT_PROPS,
  USERNAME_INPUT_PROPS,
} from "../src/lib/ui/text-input-props";

const results: string[] = [];

/* -- the prop sets say what they need to -- */
{
  for (const [name, props] of [
    ["code", CODE_INPUT_PROPS],
    ["code-or-link", CODE_OR_LINK_INPUT_PROPS],
    ["username", USERNAME_INPUT_PROPS],
    ["one-time code", OTP_INPUT_PROPS],
  ] as const) {
    assert.equal((props as { autoCorrect: string }).autoCorrect, "off",
      `${name} fields must not be autocorrected — substitution is invisible to the player`);
    assert.equal((props as { spellCheck: boolean }).spellCheck, false,
      `${name} fields must not be spellchecked`);
  }
  assert.equal(CODE_INPUT_PROPS.autoCapitalize, "characters", "codes are uppercase");
  assert.equal(USERNAME_INPUT_PROPS.autoCapitalize, "none", "usernames are not sentences");
  assert.equal(CODE_OR_LINK_INPUT_PROPS.autoCapitalize, "none",
    "a field that might hold a link must not force case");
  assert.equal(OTP_INPUT_PROPS.autoComplete, "one-time-code", "so the keyboard offers the code itself");
  assert.equal(OTP_INPUT_PROPS.inputMode, "numeric", "and shows a number pad");
  assert.equal(USERNAME_INPUT_PROPS.autoComplete, "username", "so a saved username can be filled");
  results.push("props     codes, usernames and one-time codes each opt out of correction and get the right keyboard");
}

/* -- and the fields actually use them -- */
{
  for (const [name, path, spec] of [
    ["friend code lookup", "src/app/(game)/app/friends/friends-client.tsx", "CODE_INPUT_PROPS"],
    ["invite accept", "src/app/(game)/app/friends/friends-client.tsx", "CODE_OR_LINK_INPUT_PROPS"],
    ["redemption code", "src/components/cozy/redemption-code-panel.tsx", "CODE_INPUT_PROPS"],
    ["onboarding username", "src/components/onboarding/profile-form.tsx", "USERNAME_INPUT_PROPS"],
    ["account username", "src/components/account/username-settings-panel.tsx", "USERNAME_INPUT_PROPS"],
    ["two-factor code", "src/components/auth/mfa-panel.tsx", "OTP_INPUT_PROPS"],
  ] as const) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes(`{...${spec}}`), `${name} must spread ${spec}`);
  }
  results.push("fields    6 code / username / OTP inputs spread the right set");
}

/* -- THE BUG: a pasted invite link must not be case-folded --
   The accept field uppercased everything. An invite link carries a base64url
   token, and `?accept=` is a case-sensitive parameter NAME, so folding turned
   it into `?ACCEPT=` and searchParams.get("accept") returned null. Pasting a
   link could never work, on any platform. */
{
  for (const link of [
    "https://realfiction.store/app/friends?accept=eyJhbGciOi",
    "HTTPS://REALFICTION.STORE/APP/FRIENDS?ACCEPT=X",
    "http://localhost:3000/app/friends?accept=abc",
    "realfiction.store/app/friends?accept=abc",
  ]) {
    assert.equal(looksLikeInviteLink(link), true, `"${link}" must be recognised as a link and left alone`);
  }

  for (const code of ["HH-A7F2C-421", "hh-a7f2c-421", "  HH-XXXXX-NNN  ", ""]) {
    assert.equal(looksLikeInviteLink(code), false, `"${code}" is a bare code and may be folded uppercase`);
  }

  // The component must fold conditionally rather than unconditionally.
  const source = readFileSync("src/app/(game)/app/friends/friends-client.tsx", "utf8");
  assert.ok(source.includes("looksLikeInviteLink(raw) ? raw : raw.toUpperCase()"),
    "the accept field must fold case only when it holds a bare code");
  assert.ok(!/setAcceptInput\(event\.target\.value\.toUpperCase\(\)\)/.test(source),
    "the unconditional uppercase that broke pasted links must not come back");
  results.push("invites   links are detected and left case-intact · bare codes still fold · the paste bug cannot return");
}

console.log(`\nMobile inputs: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
