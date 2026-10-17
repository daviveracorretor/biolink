-- Configure only your own Supabase Auth user as the site administrator.
-- Owner UUID: d4f4490d-96f2-406b-bced-6f0a27d31116
-- Keep this UUID aligned with config.js if you change the administrator.

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text,
  region text,
  price numeric,
  area numeric,
  bedrooms integer,
  suites integer,
  bathrooms integer,
  parking integer,
  features jsonb not null default '[]'::jsonb,
  payment text,
  code text,
  status text not null default 'draft' check (status in ('draft', 'published', 'reserved', 'sold')),
  featured boolean not null default false,
  photos jsonb not null default '[]'::jsonb,
  cover text,
  created_at timestamptz not null default now()
);

alter table public.properties enable row level security;
grant select on public.properties to anon, authenticated;
grant insert, update, delete on public.properties to authenticated;

drop policy if exists "Visitors read public listings; owner reads all" on public.properties;
create policy "Visitors read public listings; owner reads all"
  on public.properties for select to anon, authenticated
  using (
    status in ('published', 'reserved', 'sold')
    or auth.uid() = 'd4f4490d-96f2-406b-bced-6f0a27d31116'::uuid
  );

drop policy if exists "Only site owner inserts listings" on public.properties;
create policy "Only site owner inserts listings"
  on public.properties for insert to authenticated
  with check (auth.uid() = 'd4f4490d-96f2-406b-bced-6f0a27d31116'::uuid);

drop policy if exists "Only site owner updates listings" on public.properties;
create policy "Only site owner updates listings"
  on public.properties for update to authenticated
  using (auth.uid() = 'd4f4490d-96f2-406b-bced-6f0a27d31116'::uuid)
  with check (auth.uid() = 'd4f4490d-96f2-406b-bced-6f0a27d31116'::uuid);

drop policy if exists "Only site owner deletes listings" on public.properties;
create policy "Only site owner deletes listings"
  on public.properties for delete to authenticated
  using (auth.uid() = 'd4f4490d-96f2-406b-bced-6f0a27d31116'::uuid);

insert into storage.buckets (id, name, public)
values ('property-photos', 'property-photos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Visitors read property photos" on storage.objects;
create policy "Visitors read property photos"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'property-photos');

drop policy if exists "Only site owner uploads property photos" on storage.objects;
create policy "Only site owner uploads property photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'property-photos' and auth.uid() = 'd4f4490d-96f2-406b-bced-6f0a27d31116'::uuid);

drop policy if exists "Only site owner updates property photos" on storage.objects;
create policy "Only site owner updates property photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'property-photos' and auth.uid() = 'd4f4490d-96f2-406b-bced-6f0a27d31116'::uuid)
  with check (bucket_id = 'property-photos' and auth.uid() = 'd4f4490d-96f2-406b-bced-6f0a27d31116'::uuid);

drop policy if exists "Only site owner deletes property photos" on storage.objects;
create policy "Only site owner deletes property photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'property-photos' and auth.uid() = 'd4f4490d-96f2-406b-bced-6f0a27d31116'::uuid);
