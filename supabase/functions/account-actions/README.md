# account-actions

Authenticated account-management actions that require server privileges.

## delete-account

Input:

```json
{"action":"delete-account"}
```

The request must include a valid Supabase JWT. Consumer accounts are deleted through Supabase Auth admin APIs. Account-owned rows cascade where the schema is designed for deletion; contribution/history tables that intentionally use `ON DELETE SET NULL` retain de-identified observations.

Accounts that currently own an `advertiser_businesses` record receive a 409 review-required response so business ownership is not silently destroyed.

The function is deployed with JWT verification enabled.
