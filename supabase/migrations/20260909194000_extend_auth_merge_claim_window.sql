-- Verification and recovery emails can be delayed or opened later. Keep the random,
-- device-held contribution merge claim long enough for a normal account handoff.
alter table public.auth_merge_claims
  alter column expires_at set default (now() + interval '24 hours');

-- Extend any still-pending short claims created by the initial release.
update public.auth_merge_claims
set expires_at = greatest(expires_at, created_at + interval '24 hours')
where claimed_at is null;
