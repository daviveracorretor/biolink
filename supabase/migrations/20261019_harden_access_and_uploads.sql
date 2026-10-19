-- Security hardening for an existing project.
-- Run manually in Supabase SQL Editor only after reviewing the changes.
-- No property rows or stored files are deleted or changed by this migration.

begin;

-- Keep the public role read-only; signed-in administrators retain CRUD access
-- subject to the table's existing RLS policies.
revoke all privileges on table public.properties from public, anon, authenticated;
grant select on table public.properties to anon, authenticated;
grant insert, update, delete on table public.properties to authenticated;

-- Enforce image formats and a 20 MiB cap at the Storage service itself.
update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'
    ]::text[]
where id = 'property-photos';

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'property-photos') then
    raise exception 'Bucket property-photos não existe; interrompendo a migração sem alterar anúncios.';
  end if;
end;
$$;

-- Public buckets serve known object URLs without a SELECT policy. Removing
-- anonymous SELECT prevents visitors from listing every object's metadata.
drop policy if exists "Visitors read property photos" on storage.objects;
drop policy if exists "Only site owner reads property photo metadata" on storage.objects;
create policy "Only site owner reads property photo metadata"
  on storage.objects for select to authenticated
  using (bucket_id = 'property-photos' and auth.uid() = 'd4f4490d-96f2-406b-bced-6f0a27d31116'::uuid);

commit;
