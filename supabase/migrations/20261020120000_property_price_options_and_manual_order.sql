-- Optional price presentation settings and a stable manual listing order.
begin;

alter table public.properties
  add column if not exists price_display text not null default 'total',
  add column if not exists entry_price numeric,
  add column if not exists entry_label text not null default 'Entrada',
  add column if not exists entry_installments integer,
  add column if not exists display_order integer;

alter table public.properties
  drop constraint if exists properties_price_display_check,
  add constraint properties_price_display_check check (price_display in ('total', 'entry', 'both')),
  drop constraint if exists properties_entry_label_check,
  add constraint properties_entry_label_check check (entry_label in ('Entrada', 'Sinal')),
  drop constraint if exists properties_entry_price_nonnegative_check,
  add constraint properties_entry_price_nonnegative_check check (entry_price is null or entry_price >= 0),
  drop constraint if exists properties_entry_installments_positive_check,
  add constraint properties_entry_installments_positive_check check (entry_installments is null or entry_installments > 0);

with ranked as (
  select id, row_number() over (order by featured desc, created_at desc, id asc) - 1 as position
  from public.properties
  where display_order is null
)
update public.properties p
set display_order = ranked.position
from ranked
where p.id = ranked.id;

alter table public.properties alter column display_order set default 0;
alter table public.properties alter column display_order set not null;
create index if not exists properties_manual_listing_order_idx on public.properties (featured desc, display_order asc, created_at asc);

create or replace function public.reorder_properties(property_ids uuid[])
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is distinct from 'd4f4490d-96f2-406b-bced-6f0a27d31116'::uuid then
    raise exception 'Only the site administrator may reorder properties.' using errcode = '42501';
  end if;
  if coalesce(cardinality(property_ids), 0) <> (select count(*) from public.properties)
     or exists (
       select 1 from public.properties p
       where not (p.id = any(coalesce(property_ids, '{}'::uuid[])))
     ) then
    raise exception 'The order must include every property exactly once.' using errcode = '22023';
  end if;
  if cardinality(property_ids) <> (select count(distinct id) from unnest(property_ids) as ids(id)) then
    raise exception 'Duplicate property IDs are not allowed.' using errcode = '22023';
  end if;
  update public.properties p
  set display_order = ordered.position - 1
  from unnest(property_ids) with ordinality as ordered(id, position)
  where p.id = ordered.id;
end;
$$;

revoke all on function public.reorder_properties(uuid[]) from public, anon;
grant execute on function public.reorder_properties(uuid[]) to authenticated;
commit;
