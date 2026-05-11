-- Account-scoped private content gates.
-- Generic preview accounts see public HeartHaven content only.
-- Service-role/admin SQL can grant private gift content to specific accounts or an accepted partner link.

create table public.private_content_entitlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  partner_link_id uuid references public.partner_links(id) on delete cascade,
  content_key text not null,
  enabled boolean not null default true,
  granted_by uuid references public.profiles(id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, content_key)
);

create index private_content_entitlements_profile_idx
on public.private_content_entitlements (profile_id);

create index private_content_entitlements_partner_idx
on public.private_content_entitlements (partner_link_id)
where partner_link_id is not null;

create trigger private_content_entitlements_set_updated_at
before update on public.private_content_entitlements
for each row execute function public.set_updated_at();

alter table public.private_content_entitlements enable row level security;

create policy "Players read their private content entitlements"
on public.private_content_entitlements for select to authenticated
using (auth.uid() = profile_id or public.is_partner_member(partner_link_id));

create or replace function public.has_private_content(required_content_key text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.private_content_entitlements pce
    where pce.content_key = required_content_key
      and pce.enabled = true
      and (
        pce.profile_id = auth.uid()
        or public.is_partner_member(pce.partner_link_id)
      )
  );
$$;

grant execute on function public.has_private_content(text) to authenticated;

update public.catalog_items
set
  metadata = metadata || jsonb_build_object('private_content_key', 'private_couple_gift_content'),
  updated_at = now()
where rarity = 'private';

drop policy if exists "Catalog is readable by players" on public.catalog_items;

create policy "Players read public catalog and entitled private catalog"
on public.catalog_items for select to authenticated
using (
  active = true
  and (
    rarity <> 'private'
    or public.has_private_content(coalesce(metadata->>'private_content_key', 'private_couple_gift_content'))
  )
);

comment on table public.private_content_entitlements is
  'Admin-managed switches for account-specific HeartHaven gift content.';

comment on column public.private_content_entitlements.content_key is
  'Example: private_couple_gift_content. Grant this key to each intended account, or attach it to an accepted partner link.';

-- Example grant, run with the service role/admin SQL after replacing IDs:
-- insert into public.private_content_entitlements (profile_id, partner_link_id, content_key, notes)
-- values ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'private_couple_gift_content', 'Enable private couple gift content');
