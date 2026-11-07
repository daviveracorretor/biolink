-- Flexible price lines for a listing.
-- Each item is { label, text, highlight } and is rendered in order on the site.
begin;

alter table public.properties
  add column if not exists price_items jsonb not null default '[]'::jsonb;

comment on column public.properties.price_items is
  'Ordered price lines: [{"label":"Sinal","text":"de R$ 20 mil","highlight":true}, ...].';

-- Seed the new column from the legacy fields so existing listings keep their values.
update public.properties
set price_items = coalesce((
  select jsonb_agg(jsonb_build_object(
    'label', case when i = 0 then coalesce(nullif(price_highlight_label, ''), 'Valor total') else coalesce(nullif(price_secondary_label, ''), 'Entrada') end,
    'text', case when i = 0 then coalesce(nullif(price_highlight_label, ''), to_char(price, 'FM999G999G999D00')) else coalesce(nullif(price_secondary_label, ''), to_char(entry_price, 'FM999G999G999D00')) end,
    'highlight', i = 0
  ) order by i)
  from generate_series(0, 1) as i
  where (i = 0 and price is not null) or (i = 1 and entry_price is not null)
), '[]'::jsonb)
where jsonb_array_length(price_items) = 0;

commit;
