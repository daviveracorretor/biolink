-- Free text for the three price lines shown on a listing.
-- When filled, these strings replace the value the site would format automatically.
begin;

alter table public.properties
  add column if not exists price_highlight_label text,
  add column if not exists price_secondary_label text,
  add column if not exists price_extra_label text;

comment on column public.properties.price_highlight_label is
  'Free text for the emphasised price line (e.g. "Sinal de R$ 20 mil").';
comment on column public.properties.price_secondary_label is
  'Free text for the secondary price line (e.g. "Restante da entrada em 40x").';
comment on column public.properties.price_extra_label is
  'Free text for a third, extra price line (e.g. "Valor total de 299 mil").';

commit;
