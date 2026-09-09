create index if not exists auth_merge_claims_target_idx
  on public.auth_merge_claims(target_user_id)
  where target_user_id is not null;
