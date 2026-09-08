alter table public.catalogue_import_state add column if not exists page_token text;
alter table public.catalogue_import_state add column if not exists page_number integer not null default 0 check (page_number >= 0);
