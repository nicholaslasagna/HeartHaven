# HeartHaven

A cozy, multiplayer, browser-based world for two — adopt a companion, decorate a room, tend a garden, host friends, play mini-games together. Built to feel like Webkinz if it grew up alongside you and remembered the people you love.

Production: **[realfiction.store](https://realfiction.store)**

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** + **Tailwind v4**
- **Phaser 3.90** for the in-world canvases (dynamically imported, SSR-disabled)
- **Supabase** for auth, Postgres, realtime presence + broadcasts, row-level security
- **Resend** for transactional email (account suspension notices)
- Deployed via **OpenNext on Cloudflare Pages**

## Running locally

```bash
pnpm install
cp .env.example .env.local        # fill in real values
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Required env vars

`.env.example` lists everything with comments. The minimum set to boot:

- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — your Supabase project.
- `NEXT_PUBLIC_SITE_URL` — used for magic-link + password-reset redirects.

Additional vars unlock specific features (Resend for ban emails, an internal webhook secret for admin operations). The app degrades gracefully when optional vars are unset — it'll say "online services not configured" rather than crash.

### Verifying a change

Before opening a PR:

```bash
pnpm exec tsc --noEmit
pnpm exec eslint --quiet src
pnpm exec next build
```

All three exit 0 = good.

## Project layout

```
src/
  app/                       Next.js App Router routes
    (game)/app/              Authenticated game shell
      area/                  Seamless room/garden/park hub
      friends/               Friend graph + invites
      games/                 Mini-game picker + party lobby
      account/               Account settings (username, phone, MFA)
      pet/                   Companion care studio
      <mini-game>/           Per-game routes (bowling, memory-match, etc.)
    auth/                    Sign in / up / forgot-password / callback
    account-suspended/       Ban landing page
  components/
    game/                    Phaser canvases + in-world UI panels
    layout/                  Shell, header, nav
    auth/                    Auth-adjacent components (MFA, ban watchdog)
    ui/                      Shared primitives (Button, Card, Input)
  lib/
    game/                    State stores, hooks, realtime plumbing
    supabase/                Browser + server Supabase clients
    auth/                    Auth helpers (phone normalization, etc.)
supabase/
  migrations/                Numbered SQL migrations (apply in order)
  auth-templates/            Supabase Auth email templates
scripts/                     Asset generators (Phaser sprite sheets)
```

## Supabase setup

The migrations in `supabase/migrations/` are the source of truth for the schema. Apply them in order via `supabase db push` or by pasting them into the SQL editor.

Highlights:

- **0001** — base schema (profiles, wallets, pets, rooms, partner links).
- **0010 / 0023 / 0026–0028** — safety + permanent + temporary ban system.
- **0024 / 0029** — multiplayer state sync (room placements, garden decor, party lobbies, realtime publication).

Migrations are idempotent (`create table if not exists`, etc.) so re-running is safe.

## Multiplayer model

- **Presence + position broadcasts** — Supabase Realtime per-channel (`room:<hostCode>`, `garden:<hostCode>.<gardenId>`).
- **Canonical state** — host-owned rows in `room_placements_state` / `garden_decor_state` mirror the world layout. Edits funnel through SECURITY DEFINER RPCs with optimistic-concurrency versioning.
- **Party lobbies** — server-backed via `game_sessions` + `lobby_join_requests` + `lobby_events`. Request-to-join model: guests knock with the host's friend code, host accepts/denies. When the host hits start, every seated guest auto-navigates to the chosen game URL.

## Contributing

Issues and PRs welcome. Please:

1. Fork + branch off `main`.
2. Run the three verification commands above before pushing.
3. Match the surrounding code style — warm, technical comments that explain *why* not *what*.
4. No emojis in source code or markdown unless explicitly asked.

## License

[MIT](./LICENSE). Use it, fork it, build something cozy.
