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
- [x] Game session and reward event schema.
- [x] Private content entitlement gate.
- [x] Private story payload table for account-only copy.
- [x] Local wallet reward loop for playable MVP.
- [ ] Apply migration to Supabase.
- [ ] Add profile creation server action.
- [ ] Add adoption server action.
- [ ] Replace mock wallet, pet, inventory, and room data with Supabase reads.
- [x] Add local furniture placement save/load.
- [ ] Add Supabase furniture placement save mutation.

## Phase 3: Phaser Room

- [x] Browser-only Phaser 3 room renderer.
- [x] Player avatar.
- [x] Casper companion sprite placeholder.
- [x] Clickable room item interactions.
- [x] Click-to-move and keyboard movement.
- [x] Drag/drop/rotate furniture placement.
- [x] Local save/load placed items.
- [ ] Save/load placed items from Supabase.

## Phase 4: Mini-Games

- [x] Memory Match route and Phaser scene.
- [x] Petal Catch route and Phaser scene.
- [x] Moonberry Bowling route and Phaser scene.
- [x] Lantern Relay route and Phaser scene.
- [x] Heart Hunt route and Phaser scene.
- [x] Local reward wallet and ledger.
- [x] Game reward event schema.
- [x] Coins and hearts payout rules.
- [ ] Anti-abuse score validation.

## Phase 5: Friends And Partner Features

- [x] Friend code and partner link tables.
- [x] Love note and memory book tables.
- [ ] Friend code search UI.
- [ ] Friend request accept/decline.
- [ ] Partner invite UI.
- [x] Shared partner garden route.
- [x] Love note compose draft flow.
- [x] Memory book interactive page draft flow.
- [ ] Persist love note schedule, read, and archive flows.
- [ ] Persist memory book page editor.

## Phase 6: Multiplayer Presence

- [x] Room session tables.
- [x] Game session tables.
- [x] Local party games and lobby seats.
- [ ] Supabase Realtime channel per room session.
- [ ] Presence payload for avatar position, pet position, and emote.
- [ ] Invite friend to room flow.
- [ ] Show both avatars.
- [ ] Realtime movement interpolation.
- [ ] Emote wheel and cooldown.

## Phase 7: Account-Scoped Private Gift Content

- [x] Private catalog and milestone names defined.
- [x] SQL entitlement table for account-specific private content.
- [x] SQL payload table for private relationship-specific text.
- [x] Casper public companion content.
- [x] Private partner garden unlock data path.
- [x] Guardian garden scene content shell.
- [x] Message Milestone marker.
- [x] Study Week quest marker.
- [x] Shared Visit quest marker.
- [x] Milestone quest marker.
- [ ] Private memory book pages.
- [ ] Private love note access rules and UI.

## Production Hardening

- [ ] Add rate limiting for notes, invites, and mini-game rewards.
- [ ] Add service-role admin jobs for catalog and reward processing.
- [ ] Add Playwright coverage for onboarding, room, garden, and shop.
- [ ] Add Supabase local test seed.
- [ ] Add deployment environment documentation.
