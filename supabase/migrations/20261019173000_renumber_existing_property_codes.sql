begin;

-- Replace legacy listing codes with the category-based format for every
-- existing property, ordered by creation time. The insert/update trigger
-- continues assigning codes for future listings.
drop trigger if exists assign_property_code_before_write on public.properties;

update public.properties set code = null;
update public.property_code_counters set last_value = 0;

create trigger assign_property_code_before_write
before insert or update on public.properties
for each row execute function public.assign_property_code();

do $$
declare
  property_row record;
begin
  for property_row in
    select id
    from public.properties
    order by created_at nulls last, id
  loop
    update public.properties set code = '' where id = property_row.id;
  end loop;
end;
$$;

commit;
