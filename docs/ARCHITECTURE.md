# HeartHaven Architecture

HeartHaven is structured as a production-minded Next.js App Router project with a Phase 1 mock front end and Phase 2 ready persistence boundaries.

## File Structure

```text
src/app
  page.tsx                         landing page
  auth/sign-in/page.tsx            Supabase sign-in form
  auth/sign-up/page.tsx            Supabase sign-up form
  onboarding/profile/page.tsx      profile creation
  onboarding/adopt/page.tsx        pet adoption
  (game)/app/layout.tsx            authenticated game shell
  (game)/app/page.tsx              player dashboard
  (game)/app/room/page.tsx         Phaser room screen
  (game)/app/garden/page.tsx       garden screen
  (game)/app/bowling/page.tsx      Moonberry Bowling mini-game
  (game)/app/lantern-relay/page.tsx Lantern Relay mini-game
  (game)/app/heart-hunt/page.tsx   Heart Hunt mini-game
  (game)/app/shop/page.tsx         shop and inventory mock
src/components
  brand                            logo, illustrations, motion scene
  game                             Phaser canvas renderer
  layout                           site and game navigation shells
  onboarding                       onboarding forms
  ui                               owned shadcn-style primitives
src/lib
  catalog.ts                       starter pets, items, private milestones
  game/types.ts                    shared game domain types
  supabase                         lazy browser/server client helpers
supabase/migrations                schema, seed data, and RLS policies
docs                               architecture and phase checklist
```

## Component Boundaries

Server Components own route composition, metadata, and data loading. Client Components are used where browser APIs are needed: Framer Motion for the landing scene, Phaser for the game canvases, and localStorage for MVP room layouts and wallet reward state.

The `src/components/ui` directory contains shadcn-style owned primitives instead of opaque package components. This keeps styling and accessibility locally editable while preserving the composition model expected by shadcn/ui projects.

## Data Model

Core ownership flows through `profiles.id`, which references `auth.users.id`. User-owned tables include `pets`, `worlds`, `rooms`, `gardens`, `inventory_items`, `placed_items`, `wallets`, `achievements`, and `quests`.

Social and partner features are separated into `friendships`, `partner_links`, `love_notes`, and `memory_book_pages`. Account-specific gift content is represented as private catalog items, achievements, quests, and memory pages scoped through accepted partner links, `private_content_entitlements`, and `private_content_payloads`.

Realtime room presence uses `room_sessions` and `room_session_members` for durable session records. Supabase Realtime presence channels should carry transient movement and emote state, while the tables store session membership and recovery data.

Mini-game multiplayer and rewards flow through `game_sessions`, `game_session_players`, and `game_reward_events`. The current app updates a local wallet immediately for responsiveness; production reward writes should be validated by trusted server/service-role code before updating `wallets`.

## Supabase Rules

RLS is owner-first by default. Records are readable or writable by their owner unless a table explicitly supports relationship access. Accepted partner links unlock partner gardens, shared memory pages, and partner quests.

Public catalog items are readable by authenticated players but not writable from client policies. Private catalog rows and private story payloads require an enabled entitlement, so couple-specific gift content can stay hidden from generic preview accounts. Catalog mutation should happen through migrations, admin tooling, or service-role server jobs.

## Game Runtime

The room renderer is isolated in `RoomCanvas` and dynamically imports Phaser 3 in the browser. Current mock placements mirror the `placed_items` table shape and locally save to the browser, so Phase 3 can replace localStorage with Supabase reads and save drag/drop edits without changing the screen contract.

The mini-games use the same pattern: Phaser owns input, animation, scoring, and reward calculation; React owns route chrome, wallet display, and overlay state. Petal Catch, Memory Match, Moonberry Bowling, Lantern Relay, and Heart Hunt all emit a common `GameReward` shape.
