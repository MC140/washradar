# WashRadar HQ

WashRadar HQ is the founder-only operating layer for running WashRadar with a small set of event-driven software agents.

## Month 1 rule: Zero-Cost Mode

The first release deliberately keeps incremental AI/infrastructure spend at **$0**:

- no paid AI provider is enabled;
- no always-on agent process is required;
- agents run only when the founder asks for a scan or gives HQ a goal;
- deterministic data/rule analysis does the work that does not require an LLM;
- existing Supabase + Cloudflare Pages + GitHub infrastructure is reused;
- consequential external actions remain human-controlled.

The database settings are the durable source of truth:

- `zero_cost_mode = true`
- `paid_ai_enabled = false`
- `cloudflare_ai_enabled = false`
- `monthly_budget_usd = 0`

A future free-tier or paid inference provider should be added behind the HQ orchestration boundary rather than embedded directly into individual agents.

## Agents

1. **Chief of Staff** — converts founder goals into coordinated cross-functional work.
2. **Product Agent** — watches product signals and creates product follow-ups.
3. **Engineering Agent** — checks public GitHub pull-request/workflow health and release follow-ups.
4. **Data Agent** — checks catalogue freshness and business-hours coverage.
5. **Growth Agent** — watches the advertiser pipeline; it does not send outreach automatically.
6. **Operations Agent** — watches queue/report/moderation operating signals.

## Shared Brain

HQ stores internal memory in `hq_memory` and agent execution history in `hq_agent_runs`.

The first implementation intentionally does not create a separate vector database. WashRadar's operational data already lives in Postgres and the current memory volume is small enough to query directly.

## Founder controls

The web UI lives at:

`/admin/hq`

Access is protected by the existing Supabase `admin` Edge Function and `ADMIN_EMAILS` allowlist.

The founder can:

- run a live six-agent company scan;
- give the Chief of Staff a company goal;
- create and assign tasks;
- start, block or complete HQ work;
- review approval requests;
- see shared memory;
- see production/data/product/GitHub operating signals.

## Goal planning

Goal planning is intentionally deterministic in Zero-Cost Mode. A founder goal creates a Chief of Staff coordination task plus specialist tasks for Product, Engineering, Data, Growth and Operations.

This is useful immediately without pretending that a free rule engine is equivalent to a frontier LLM. Later inference can improve decomposition while keeping the same task, approval and audit model.

## Company scan

A manual scan reads live operational metrics through the internal-only `hq_operational_snapshot()` database function and public GitHub metadata.

Current checks include:

- active wash count;
- business-hours coverage;
- catalogue records stale for 30+ days;
- queue reports in the last 24 hours;
- nearby queue evidence;
- active queue sessions;
- pending moderation;
- advertiser/business campaign counts;
- 7-day app-open/search/support signals;
- same-day tracked API request count;
- open/draft GitHub PRs;
- recent failed GitHub Action runs.

The scan writes an auditable run record for every agent and only creates a follow-up task when a rule detects something actionable. Dedupe keys prevent the same unresolved issue from being recreated every scan.

## Approval model

HQ has a dedicated `hq_approvals` table from the beginning.

The first release does not grant autonomous authority to:

- send external email or bulk outreach;
- merge/deploy code;
- modify production data outside narrowly defined existing admin tools;
- spend money;
- sign contracts or make legal commitments.

Those capabilities should be integrated later as explicit tools with approval gates and audit records.

## Security

All HQ tables have RLS enabled and direct `anon` / `authenticated` privileges revoked. The browser does not read or write HQ tables directly.

Founder actions go through the JWT-protected `admin` Edge Function. The function checks the authenticated email against `ADMIN_EMAILS` and performs internal work using the service role.

## Tables

- `hq_agents`
- `hq_tasks`
- `hq_agent_runs`
- `hq_approvals`
- `hq_memory`
- `hq_settings`

## Next step after Month 1

Only add model inference if the deterministic HQ proves useful. Keep the provider swappable and route only reasoning/generation work through it. SQL, rules, counters, schedules, permissions and audit logging should stay ordinary software.
