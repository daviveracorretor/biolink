begin;

-- Generate stable category-based listing codes for new and legacy uncoded rows.
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
  if nullif(btrim(new.code), '') is not null then
    return new;
  end if;

  code_prefix := case lower(btrim(coalesce(new.category, '')))
    when 'planta' then 'PL'
    when 'novos' then 'PL'
    when 'lancamentos' then 'PL'
    when 'lançamentos' then 'PL'
    when 'lancamento' then 'PL'
    when 'lançamento' then 'PL'
    when 'cohapar' then 'CH'
    when 'minha casa minha vida' then 'CH'
    when 'mcmv' then 'CH'
    when 'lotes' then 'LT'
    when 'terrenos' then 'LT'
    when 'prontos' then 'PR'
    when 'casas' then 'PR'
    when 'apartamentos prontos' then 'PR'
    else 'IM'
  end;

  loop
    insert into public.property_code_counters (prefix, last_value)
    values (code_prefix, 1)
    on conflict (prefix) do update
      set last_value = public.property_code_counters.last_value + 1
    returning last_value into next_number;

    candidate := code_prefix || '-' || lpad(next_number::text, 3, '0');
    exit when not exists (
      select 1 from public.properties
      where upper(code) = candidate and id is distinct from new.id
    );
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

-- Fill missing codes on older listings in a predictable creation order.
do $$
declare
  property_row record;
begin
  for property_row in
    select id from public.properties
    where nullif(btrim(code), '') is null
    order by created_at, id
  loop
    update public.properties set code = '' where id = property_row.id;
  end loop;
end;
$$;

commit;
