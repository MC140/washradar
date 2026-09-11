-- Production recorded the idempotent local_radius_ad_inventory migration a second time
-- during deployment. The schema changes are already represented in 20260911004930.
-- Keep this no-op marker so repository migration history stays aligned with production.
select 1;
