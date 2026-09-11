-- Manual-first advertiser onboarding for the initial WashRadar sales motion.
-- A local business does not need a WashRadar account just to buy a sponsored placement.

alter table public.advertiser_businesses
  alter column owner_user_id drop not null;

alter table public.advertiser_businesses
  add column if not exists region text,
  add column if not exists postal_code text,
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text;

alter table public.advertiser_businesses
  drop constraint if exists advertiser_businesses_contact_name_length,
  add constraint advertiser_businesses_contact_name_length
    check (contact_name is null or char_length(contact_name) <= 120),
  drop constraint if exists advertiser_businesses_contact_email_length,
  add constraint advertiser_businesses_contact_email_length
    check (contact_email is null or char_length(contact_email) <= 254),
  drop constraint if exists advertiser_businesses_contact_phone_length,
  add constraint advertiser_businesses_contact_phone_length
    check (contact_phone is null or char_length(contact_phone) <= 40),
  drop constraint if exists advertiser_businesses_region_length,
  add constraint advertiser_businesses_region_length
    check (region is null or char_length(region) <= 120),
  drop constraint if exists advertiser_businesses_postal_code_length,
  add constraint advertiser_businesses_postal_code_length
    check (postal_code is null or char_length(postal_code) <= 20);

comment on column public.advertiser_businesses.owner_user_id is
  'Optional linked WashRadar account. NULL means the advertiser is staff-managed during manual onboarding.';
comment on column public.advertiser_businesses.contact_name is
  'Private advertiser sales/billing contact; protected by advertiser RLS and not used in public ad selection.';
comment on column public.advertiser_businesses.contact_email is
  'Private advertiser sales/billing email; protected by advertiser RLS and not used in public ad selection.';
comment on column public.advertiser_businesses.contact_phone is
  'Private advertiser sales/billing phone; protected by advertiser RLS and not used in public ad selection.';
comment on column public.advertiser_businesses.region is
  'Province/state/region for the advertiser business address.';
comment on column public.advertiser_businesses.postal_code is
  'Postal/ZIP code for the advertiser business address; targeting itself remains coordinate/radius based.';
