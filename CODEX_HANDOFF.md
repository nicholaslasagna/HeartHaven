# Codex handoff — multiplayer + invites + lobby redesign

This file is the brief Nick will copy-paste to Codex. Server-side groundwork is done; this is the UI consolidation pass.

## What just shipped (don't redo)

- **Migration `0029_party_lobbies.sql`** — server-backed party lobbies live now. Tables: `game_sessions` (extended with `selected_game_key/href/label`, `host_friend_code`), `game_session_players`, `lobby_join_requests`, `lobby_events`. RPCs: `create_party_lobby`, `find_party_lobby`, `request_join_party`, `respond_join_request`, `select_party_game`, `start_party_lobby`, `leave_party_lobby`, `kick_party_seat`. Realtime publication includes all four tables.
- **New hook `useServerPartyLobby`** at `src/lib/game/use-server-party-lobby.ts`. Same conceptual surface as the old `usePartyLobby`, new shape. Return value:

  ```ts
  {
    lobby: LobbyState | null,
    ready: boolean,           // !loading
    loading: boolean,
    error: string | null,
    isHost: boolean,
    selfSeated: boolean,
    joinRequests: LobbyJoinRequest[],  // pending, host only
    localFriendCode: string,
    // actions (all async, return { ok: true } | { ok: false, reason })
    createLobby(maxPlayers?: number),
    requestJoin(hostFriendCode: string),
    approveRequest(requestId: string),
    denyRequest(requestId: string),
    selectGame({ key, href, label? }),
    start(),    // host auto-navigates to selected_game_href; guests auto-navigate via realtime
    leave(),
    kick(profileId: string),
    toggleReady(),
    startStatus: { ok: true } | { ok: false, reason: "not-host" | "no-game" | "no-lobby" | "not-ready" },
    refresh(),
  }
  ```

- **Old `usePartyLobby`** (localStorage) is still in the tree as a deprecated shim so `games-client.tsx` keeps compiling. Replace it with `useServerPartyLobby` as part of your redesign and delete the shim afterward.
- **Seamless area routing** — `/app/room`, `/app/garden`, `/app/park` now redirect to `/app/area?zone=X`. Site-header + cross-zone "Park stage"/"Garden road" buttons + mini-game back buttons all point at the seamless container. Zone switching inside `/app/area` is a pure setState — no remount.

## What you need to build

### 1. Friends page = the only invite surface

`src/app/(game)/app/friends/friends-client.tsx` becomes THE place where invites happen. Today it's a paste-a-code form which is confusing. Redesign:

- **Header:** big "Your friend code: HH-XXXXX-NNN" with one-tap Copy. No jargon explaining what a friend code is.
- **Add a friend:** one-row form: paste-a-code OR a "Bring this person in" button next to each "Played together recently" entry.
- **Inbox:** pending invites shown as cards with friend's avatar + name as the headline (not the code). Accept / Decline buttons.
- **Active party card** (when `useServerPartyLobby().lobby` is non-null): show seated keepers with avatars + a leave button. If `isHost`, show pending join requests with Approve / Deny.
- **No paste-a-game-invite-link UI anymore.** The Friends page is for friend-graph state; the games page is for lobby state.

Use the new hook for the active-party card + join-request handling. Use the existing `useSocial` for the friend graph.

### 2. Games page = kid-friendly picker + lobby

`src/app/(game)/app/games/games-client.tsx` is currently 394 LOC of paste-a-link confusion. Rewrite as:

- **Top:** "Play together" hero with two buttons:
  - **"Start a party"** — calls `createLobby()`. Once a lobby exists, this turns into the lobby panel.
  - **"Join a friend's party"** — single input "Paste your friend's code" + a "Request to join" button. Calls `requestJoin(code)`. Shows a "Waiting for the host to let you in…" pill while the request is pending.
- **Game grid:** big tiles for each mini-game (bowling, fashion-show, memory-match, etc.). Each tile shows art + title.
  - **Solo mode** (no lobby): tile becomes a "Play" link to the game route.
  - **In a lobby:**
    - If host: tile gets a "Pick this for the party" button. The currently-picked tile is highlighted.
    - If guest: tile is read-only; the highlighted tile indicates what the host has chosen.
- **Lobby panel** (when seated): list of names with avatars, ready toggles, kick buttons (host only), pending join-request approvals (host only), "Start game" big button (host only — disabled until `startStatus.ok` is true).

The hook handles auto-navigation: when the host calls `start()`, every seated guest gets a `lobby_events.started` realtime event and `useServerPartyLobby` calls `router.push(href)` automatically.

### 3. Strip duplicate invite surfaces

Delete or simplify these — they should NOT have their own invite UI anymore:

- `src/components/game/garden-social-panel.tsx` + `src/components/game/room-social-panel.tsx` — remove the "Share code" / "Visit link" panels and the decorator-grant inline UIs. Replace with one button: "Manage friends in Friends →" that links to `/app/friends`. The realtime sync of decorator grants still happens via my migration 0024 server RPCs — Codex just removes the duplicate UI surface.
- `src/components/game/bring-party-button.tsx` — delete. The `useServerPartyLobby().start()` flow replaces it (everyone auto-navigates when the host starts a game; for "follow me to the garden" use Friends-page invite or the seamless zone tabs).
- `src/components/cozy/friend-invite-card.tsx` — only used in the Friends page now? Verify and either keep (Friends-only) or inline its display into the new friends-client.
- Any in-game-page invite buttons (mini-game pages, garden/room pages) — replace with "Bring friends from Friends →" link.

After the redesign, `usePartyLobby` (the deprecated shim) should have zero consumers — delete it and `src/lib/game/party-lobby.ts` (the localStorage module).

### 4. Style direction — pretend the user is 12

- Three or fewer primary actions per surface. If there are more, group them under a "More" disclosure.
- Friendly verbs over technical ones: "Bring friends" not "Send invite", "Pick a game" not "Select party game", "Join their party" not "Submit invite token".
- Headlines are people's names + avatars, not their friend codes. Codes are subtitle-sized.
- No exposed terminology from the data layer: never show "lobby code shape", "realtime channel", "session_id", "approved decorator", "JSON token".
- Empty states have one clear next action ("No friends yet — your friend code is HH-XXXXX-NNN. Share it.").

### 5. Carry-over from prior handoffs (still pending)

- Garden / park path tuning against the red-ink reference image
- Moonlit Loft layout reorg (canvas centered, items panel right on `md+`)
- Smoke-test multiplayer in two browser sessions (much more useful now that lobbies actually persist server-side)

## Verification before opening a PR

```
pnpm exec tsc --noEmit
pnpm exec eslint --quiet src
pnpm exec next build
```

All three exit 0. Then smoke-test the full flow:

1. Browser A: sign in, go to Games, "Start a party", pick "Bowling", note the friend code.
2. Browser B (different profile): sign in, go to Games, "Join a friend's party", paste the code from A, hit Request to join.
3. Browser A sees the request appear in real time; Approve.
4. Browser B sees themselves seated in the lobby in real time.
5. Browser A hits Start game.
6. Both browsers auto-navigate to `/app/bowling` within ~1s.

If any of those steps fails, **don't** "fix" it by adding fallback localStorage — that's the bug we just removed. Track down the actual server-side cause.

## What NOT to touch

- `supabase/migrations/0029_party_lobbies.sql` — deployed contract.
- `src/lib/game/use-server-party-lobby.ts` — the new hook is the API surface. If you find a bug, fix it; if you want to change the shape, talk to Nick first.
- The seamless `/app/area` AreaClient zone-switching mechanism — already in place.
- The `useSocial`-based friend graph — that's separate and works.
