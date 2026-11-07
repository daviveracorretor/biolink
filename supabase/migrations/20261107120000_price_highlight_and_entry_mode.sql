-- Highlighted price value and entry shown only as a number of installments.
-- The site sends both columns when saving a listing; until this migration runs, the panel drops
-- them automatically and saves the rest, so nothing is lost either way.
begin;

alter table public.properties
  add column if not exists price_highlight text not null default 'auto',
  add column if not exists entry_mode text not null default 'amount';

alter table public.properties
  drop constraint if exists properties_price_highlight_check,
  add constraint properties_price_highlight_check check (price_highlight in ('total', 'entry', 'auto')),
  drop constraint if exists properties_entry_mode_check,
  add constraint properties_entry_mode_check check (entry_mode in ('amount', 'installments'));

comment on column public.properties.price_highlight is
  'Which value leads the listing card: total, entry (entrada/sinal) or auto.';
comment on column public.properties.entry_mode is
  'How the entry is presented: amount (R$ value) or installments (only "em até Nx").';

commit;
