# WashRadar account model

WashRadar is guest-first. Browsing and basic queue contribution do not require a permanent account.

## User flow

1. Continue as guest.
2. When an account is useful, choose an enabled social provider (Google / Apple) or email + password.
3. Email/password signup verifies the email once when Supabase email confirmations are enabled.
4. Normal email/password login sends no email.
5. Password recovery sends an email only when needed.
6. The shared Supabase browser session persists across routes and refreshes until explicit sign-out or normal session invalidation.

## Existing magic-link users

Magic-link-only login is no longer the normal account flow. An existing verified account that has no password can use **Forgot / create password** once. Supabase sends a recovery email to `/auth/confirm?mode=recovery`; the user chooses a password and future logins use email + password.

Old outstanding auth links that still return to `/auth/confirm` remain compatible with the callback route.

## Anonymous contributor continuity

An anonymous contributor may later sign into an existing permanent account. Before the auth session changes, the browser requests a short-lived merge claim using `prepare_anonymous_contribution_merge()`.

After permanent authentication, `claim_anonymous_contributions(token)` can move raw contribution ownership to the signed-in account.

Transferable:
- queue reports;
- wash-type reports;
- queue-session history;
- visible contribution counters.

Not transferable:
- anonymous Radar Points;
- anonymous reputation/trust score;
- active queue timer state.

This prevents disposable anonymous identities from farming points or trust and then merging those rewards into a permanent account.

The claim table has RLS enabled with no direct browser policies. The two claim RPCs are `SECURITY DEFINER`, but validate the current Supabase user state internally and use a random short-lived claim token.

## Social providers

The frontend supports Google and Apple OAuth but only renders a provider button when `/auth/v1/settings` reports that provider as enabled. Provider credentials are external Supabase/provider configuration and must never be committed to this repository.

Required before enabling a social provider:
- create the provider credentials in Google Cloud or Apple Developer;
- configure the provider in Supabase Authentication -> Providers;
- register the Supabase callback/redirect URLs exactly as required by that provider;
- verify `https://washradar.ca/auth/confirm?mode=oauth` returns to a persisted WashRadar session.

Supabase automatic identity linking may link a verified OAuth identity to an existing account with the same verified email.

## Email delivery / SMTP

Signup verification and password recovery still require email delivery. Normal password/social login does not.

Before broad public launch, configure custom SMTP (for example Resend) in Supabase Authentication so verification and recovery are not dependent on Supabase's built-in test mailer.

## Password security

- Passwords are handled by Supabase Auth, never stored in WashRadar profile/application tables.
- WashRadar requires at least 8 characters client-side; Supabase remains the authority for server-side password policy.
- Enable Supabase **Leaked Password Protection** before broad public launch. The database security advisor currently reports it disabled.
- Keep auth rate limits enabled and consider CAPTCHA/Turnstile for signup/anonymous-auth abuse as public traffic grows.

## PWA/session behavior

The production shared client uses `persistSession`, `autoRefreshToken`, and `detectSessionInUrl`. Service-worker cache `washradar-shell-v6` was introduced with this account model so installed mobile clients do not remain on the old magic-link form.
