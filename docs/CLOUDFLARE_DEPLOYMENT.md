# Cloudflare Deployment

HeartHaven is a full-stack Next.js app, so deploy it with the OpenNext Cloudflare adapter. That preserves App Router behavior, Server Actions, Supabase Auth callbacks, and future API routes.

## Commands

```bash
npm run build
npm run build:cloudflare
npm run preview:cloudflare
npm run deploy
```

## Cloudflare Git UI Settings

For the Workers & Pages Git deployment form, use these values:

```text
Project name: HeartHaven
Path: /
Build command: npm run build:cloudflare
Deploy command: npm run deploy:cloudflare
Non-production branch deploy command: npm run upload:cloudflare
```

Do not use `npm run build` as the Cloudflare build command. That only creates `.next`; Cloudflare needs the `.open-next` worker output created by `npm run build:cloudflare`.

## Required Environment Variables

Set these in Cloudflare Workers & Pages project settings before using real auth:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SITE_URL=
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is still accepted as a legacy fallback, but Supabase now recommends publishable keys for
browser and SSR clients. `NEXT_PUBLIC_SITE_URL` should match the deployed Cloudflare URL so magic links and password
reset emails return to `/auth/callback`.

## Supabase Auth Settings

In Supabase Auth URL configuration, add each deployed domain to the allowed redirect URLs:

```text
https://your-hearthaven-domain.com/auth/callback
https://*.pages.dev/auth/callback
http://localhost:3000/auth/callback
```

Enable email/password and magic link email providers. For 2FA, enable TOTP factors in Supabase Auth MFA settings.

For production email delivery, follow [SUPABASE_AUTH_EMAIL.md](./SUPABASE_AUTH_EMAIL.md) and configure custom SMTP plus
the templates in `supabase/auth-templates/`.

## Cloudflare Notes

- `wrangler.jsonc` points to `.open-next/worker.js`.
- `nodejs_compat` is enabled for the Next.js Node runtime adapter.
- Static Next assets are cached through `public/_headers`.
- `.open-next` and `.wrangler` are ignored build outputs.
- Use `npm run preview` before deployment to test in the Workers runtime.
