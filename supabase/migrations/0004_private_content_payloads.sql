-- Private story payloads live in Supabase, not the public preview bundle.
-- Use this for account-only garden titles, quest copy, memory pages, notes, and gift metadata.

create table public.private_content_payloads (
  id uuid primary key default gen_random_uuid(),
  content_key text not null,
  slug text not null,
  title text not null,
  body text not null default '',
  payload jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_key, slug)
);

create index private_content_payloads_key_idx
on public.private_content_payloads (content_key, active);

create trigger private_content_payloads_set_updated_at
before update on public.private_content_payloads
for each row execute function public.set_updated_at();

alter table public.private_content_payloads enable row level security;

create policy "Players read entitled private payloads"
on public.private_content_payloads for select to authenticated
using (active = true and public.has_private_content(content_key));

comment on table public.private_content_payloads is
  'Entitlement-gated copy and metadata for account-specific HeartHaven gift content. Store real couple-specific names, quest titles, and memory text here instead of the public app bundle.';
