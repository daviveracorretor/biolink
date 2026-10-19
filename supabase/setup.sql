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

-- Generate a permanent code per category; counters are never rolled back when
-- an ad is deleted, so a code is never reused.
create table if not exists public.property_code_counters (
  prefix text primary key check (prefix in ('PL', 'CH', 'LT', 'PR', 'IM')),
  last_value bigint not null default 0 check (last_value >= 0)
);
alter table public.property_code_counters enable row level security;
revoke all privileges on table public.property_code_counters from public, anon, authenticated;

insert into public.property_code_counters (prefix, last_value)
select prefixes.prefix, coalesce(max(substring(upper(properties.code) from 4)::bigint), 0)
from (values ('PL'), ('CH'), ('LT'), ('PR'), ('IM')) as prefixes(prefix)
left join public.properties
  on upper(properties.code) ~ ('^' || prefixes.prefix || '-[0-9]+$')
group by prefixes.prefix
on conflict (prefix) do update
set last_value = greatest(public.property_code_counters.last_value, excluded.last_value);

create or replace function public.assign_property_code()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  code_prefix text;
  next_number bigint;
  candidate text;
begin
  if nullif(btrim(new.code), '') is not null then return new; end if;
  code_prefix := case lower(btrim(coalesce(new.category, '')))
    when 'planta' then 'PL' when 'novos' then 'PL'
    when 'lancamentos' then 'PL' when 'lançamentos' then 'PL'
    when 'lancamento' then 'PL' when 'lançamento' then 'PL'
    when 'cohapar' then 'CH' when 'minha casa minha vida' then 'CH' when 'mcmv' then 'CH'
    when 'lotes' then 'LT' when 'terrenos' then 'LT'
    when 'prontos' then 'PR' when 'casas' then 'PR' when 'apartamentos prontos' then 'PR'
    else 'IM'
  end;
  loop
    insert into public.property_code_counters (prefix, last_value) values (code_prefix, 1)
    on conflict (prefix) do update set last_value = public.property_code_counters.last_value + 1
    returning last_value into next_number;
    candidate := code_prefix || '-' || lpad(next_number::text, 3, '0');
    exit when not exists (select 1 from public.properties where upper(code) = candidate and id is distinct from new.id);
  end loop;
  new.code := candidate;
  return new;
end;
$$;
revoke all on function public.assign_property_code() from public, anon, authenticated;
drop trigger if exists assign_property_code_before_write on public.properties;
create trigger assign_property_code_before_write
before insert or update on public.properties
for each row execute function public.assign_property_code();

do $$
declare property_row record;
begin
  for property_row in
    select id from public.properties where nullif(btrim(code), '') is null
    order by created_at, id
  loop
    update public.properties set code = '' where id = property_row.id;
  end loop;
end;
$$;

alter table public.properties enable row level security;
revoke all privileges on table public.properties from public, anon, authenticated;
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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-photos', 'property-photos', true, 20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Visitors read property photos" on storage.objects;
drop policy if exists "Only site owner reads property photo metadata" on storage.objects;
create policy "Only site owner reads property photo metadata"
  on storage.objects for select to authenticated
  using (bucket_id = 'property-photos' and auth.uid() = 'd4f4490d-96f2-406b-bced-6f0a27d31116'::uuid);

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
