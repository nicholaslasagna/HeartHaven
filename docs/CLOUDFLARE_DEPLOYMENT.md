# Cloudflare Deployment

HeartHaven is a full-stack Next.js app, so deploy it with the OpenNext Cloudflare adapter. That preserves App Router behavior, Server Actions, Supabase Auth callbacks, and future API routes.

## Commands

```bash
npm run build
npm run preview
npm run deploy
```

## Required Environment Variables

Set these in Cloudflare Workers & Pages project settings before using real auth:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## Cloudflare Notes

- `wrangler.jsonc` points to `.open-next/worker.js`.
- `nodejs_compat` is enabled for the Next.js Node runtime adapter.
- Static Next assets are cached through `public/_headers`.
- `.open-next` and `.wrangler` are ignored build outputs.
- Use `npm run preview` before deployment to test in the Workers runtime.
