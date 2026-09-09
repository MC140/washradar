create table if not exists public.address_points (
  id bigint generated always as identity primary key,
  civic_no text not null,
  civic_suffix text,
  street_name text not null,
  street_type text,
  street_dir text,
  city text not null,
  postal_code text,
  latitude double precision not null,
  longitude double precision not null,
  search_text text not null,
  source_release date not null,
  source_name text not null default 'Statistics Canada National Address Register',
  created_at timestamptz not null default now()
);

alter table public.address_points enable row level security;
revoke all on table public.address_points from anon, authenticated;
grant select, insert, update, delete on table public.address_points to service_role;
grant usage, select on sequence public.address_points_id_seq to service_role;

create index if not exists address_points_search_prefix_idx
  on public.address_points (search_text text_pattern_ops);
create index if not exists address_points_postal_prefix_idx
  on public.address_points (postal_code text_pattern_ops);
create index if not exists address_points_city_idx
  on public.address_points (city);

create table if not exists public.address_import_state (
  source_name text primary key,
  source_release date,
  imported_at timestamptz,
  row_count bigint not null default 0,
  notes text
);
alter table public.address_import_state enable row level security;
revoke all on table public.address_import_state from anon, authenticated;
grant select, insert, update, delete on table public.address_import_state to service_role;

create or replace function public.address_suggestions(p_query text, p_limit integer default 8)
returns table(label text, latitude double precision, longitude double precision, postal_code text, city text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    concat_ws(' ', ap.civic_no, nullif(ap.civic_suffix, ''), ap.street_name, nullif(ap.street_type, ''), nullif(ap.street_dir, '')) || ', ' || ap.city || ', ON' || case when nullif(ap.postal_code, '') is not null then ' ' || ap.postal_code else '' end as label,
    ap.latitude,
    ap.longitude,
    ap.postal_code,
    ap.city
  from public.address_points ap
  where length(trim(coalesce(p_query, ''))) >= 4
    and ap.search_text like lower(trim(p_query)) || '%'
  order by ap.search_text
  limit least(greatest(coalesce(p_limit, 8), 1), 8);
$$;

revoke all on function public.address_suggestions(text, integer) from public, anon, authenticated;
grant execute on function public.address_suggestions(text, integer) to anon, authenticated, service_role;