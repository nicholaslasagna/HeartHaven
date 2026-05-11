# HeartHaven Implementation Checklist

## Phase 1: App Shell

- [x] Next.js App Router scaffold with TypeScript and Tailwind CSS.
- [x] shadcn-style owned UI primitives.
- [x] Framer Motion landing scene.
- [x] Landing page.
- [x] Auth pages wired to Supabase actions with env-safe failure messages.
- [x] Profile creation screen.
- [x] Pet adoption onboarding.
- [x] Dashboard.
- [x] Basic room screen.
- [x] Basic garden screen.
- [x] Inventory/shop mock.
- [x] Starter item catalog.

## Phase 2: Persistence

- [x] Supabase schema for profiles, pets, worlds, rooms, gardens, inventory, placed items, wallets, friends, partners, notes, memory pages, quests, achievements, and room sessions.
- [x] RLS policies for owner, partner, and session membership access.
- [x] Starter item catalog seed.
- [ ] Apply migration to Supabase.
- [ ] Add profile creation server action.
- [ ] Add adoption server action.
- [ ] Replace mock wallet, pet, inventory, and room data with Supabase reads.
- [ ] Add furniture placement save mutation.

## Phase 3: Phaser Room

- [x] Browser-only Phaser 3 room renderer.
- [x] Player avatar.
- [x] Pet sprite placeholder.
- [x] Clickable room item structure.
- [x] Basic keyboard movement.
- [ ] Drag/drop furniture placement.
- [ ] Save/load placed items from Supabase.
- [ ] Add room item interaction handlers.

## Phase 4: Mini-Games

- [ ] Memory Match route and Phaser scene.
- [ ] Garden Catch route and Phaser scene.
- [ ] Rewards transaction table or RPC.
- [ ] Coins and hearts payout rules.
- [ ] Anti-abuse score validation.

## Phase 5: Friends And Partner Features

- [x] Friend code and partner link tables.
- [x] Love note and memory book tables.
- [ ] Friend code search UI.
- [ ] Friend request accept/decline.
- [ ] Partner invite UI.
- [ ] Shared partner garden route.
- [ ] Love note compose, schedule, read, and archive flows.
- [ ] Memory book page editor.

## Phase 6: Multiplayer Presence

- [x] Room session tables.
- [ ] Supabase Realtime channel per room session.
- [ ] Presence payload for avatar position, pet position, and emote.
- [ ] Invite friend to room flow.
- [ ] Show both avatars.
- [ ] Realtime movement interpolation.
- [ ] Emote wheel and cooldown.

## Phase 7: Private Nicholas + Gianna Gift Content

- [x] Private catalog and milestone names defined.
- [ ] Nicholas & Gianna's Garden unlock flow.
- [ ] Casper: Guardian of Our Garden scene content.
- [ ] 365th Saved Message achievement.
- [ ] Three Finals and a Thousand Prayers quest.
- [ ] Virtual Date That Felt Real quest.
- [ ] Almost Two Years quest.
- [ ] Private memory book pages.
- [ ] Private love note access rules and UI.

## Production Hardening

- [ ] Add rate limiting for notes, invites, and mini-game rewards.
- [ ] Add service-role admin jobs for catalog and reward processing.
- [ ] Add Playwright coverage for onboarding, room, garden, and shop.
- [ ] Add Supabase local test seed.
- [ ] Add deployment environment documentation.
