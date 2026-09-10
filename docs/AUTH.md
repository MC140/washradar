# WashRadar account model

WashRadar is guest-first. Browsing and basic queue contribution do not require a permanent account.

## Current friends-beta user flow

1. Continue as a guest for browsing and basic queue contribution.
2. Email + password is the visible permanent-account method.
3. Friends-beta signup currently uses Supabase with **Confirm email OFF**, so a new account can be created and used immediately.
4. Normal email/password login sends no email.
5. Google OAuth may remain configured in Supabase, but the public friends-beta UI keeps Google sign-in hidden until there is an explicit launch decision.
6. Apple sign-in is not currently exposed.
7. Forgot-password/recovery UI stays hidden until reliable custom SMTP is configured.
8. Signed-in users can set/change their password from Profile.
9. The shared Supabase session persists across routes/refreshes until explicit sign-out or normal session invalidation.

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
- an active verified wait timer.

The merge claim is device-held and currently valid for 24 hours. This prevents disposable anonymous identities from farming points or trust and then merging those rewards into a permanent account.

The claim table has RLS enabled with no direct browser policies. The two claim RPCs are `SECURITY DEFINER`, validate the current Supabase user state internally and use a random short-lived claim token.

## Account deletion

Self-service account deletion is part of the pre-native hardening path.

- Signed-in consumer accounts can initiate permanent deletion from `/account-deletion`.
- The browser calls the authenticated `account-actions` Edge Function.
- Account-owned profile, favourites, alerts/queue targets, challenge progress, Radar Points, preferences and vehicles use cascade deletion with the Auth user where appropriate.
- Queue reports, completed queue-session evidence and wash-type reports may retain the observation with `user_id = null` where the database intentionally uses `ON DELETE SET NULL`. This preserves aggregate timing/data integrity without retaining the deleted account association.
- An account that owns an advertiser/business record is not deleted automatically. The Edge Function returns a review-required error so ownership can be transferred or closed safely.
- After deletion the client signs out locally and clears local merge/wait-session markers.

Supabase notes that deleting a user does not instantly invalidate already-issued JWTs. Sensitive server-side operations must therefore continue to authenticate/authorize every request and should not treat client sign-out as the only security boundary.

## Social providers

The frontend contains support for Google/Apple OAuth, but social buttons should only be exposed when the product explicitly enables that provider and the corresponding provider configuration is production-ready.

Before native social sign-in is enabled:
- create/configure provider credentials in Google Cloud / Apple Developer;
- configure the provider in Supabase Authentication;
- register both web and native callback/deep-link URLs;
- verify that the callback returns to a persisted WashRadar session;
- verify anonymous-contribution merge behavior across the provider transition.

Do not make Google public merely because the backend provider is configured.

## Email delivery / SMTP

The friends beta currently avoids mandatory email sends because Confirm email is OFF and password recovery remains hidden.

Before broad public/native launch:
1. configure custom SMTP in Supabase Authentication;
2. verify password-reset delivery and callback behavior on web, iOS and Android;
3. only then expose forgot-password recovery broadly;
4. decide separately whether signup email verification should be enabled.

## Password security

- Passwords are handled by Supabase Auth, never stored in WashRadar profile/application tables.
- WashRadar requires at least 8 characters client-side; Supabase remains the authority for server-side password policy.
- Enable Supabase **Leaked Password Protection** before broad public/native launch when the project plan supports it. The current security advisor reports it disabled.
- Keep auth rate limits enabled and consider CAPTCHA/Turnstile if public signup or anonymous-auth abuse becomes material.

## Web/PWA session behavior

The production shared client uses Supabase session persistence and token refresh. Installed PWA clients must continue to receive service-worker updates rather than remaining on stale auth UI.

## Native app requirements

The native apps should reuse the existing React/Supabase account model through Capacitor rather than create a second account system.

Before App Store / Play production release:
- store native session secrets using an appropriate secure-storage bridge rather than relying only on ordinary WebView local storage;
- support native app lifecycle/resume and auth deep links;
- include native WebView origins in Edge Function CORS where needed;
- keep the public `https://washradar.ca/account-deletion` resource available for store compliance;
- test account creation, login, logout, deletion and anonymous-to-permanent contribution continuity on physical iOS and Android devices.
