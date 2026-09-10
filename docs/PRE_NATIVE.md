# WashRadar pre-native readiness

Last updated: September 10, 2026

This document tracks the hardening required before WashRadar is packaged as iOS and Android apps. It does not replace README.md as the project handoff; README should be refreshed when this release merges.

## Product decision: Update queue vs wait timer

**Update queue is the primary community action.** A driver can report the current cars-ahead bucket or an operational issue without starting a timer. Those fresh reports are what help other drivers immediately.

The former **Join queue / I'm in line** concept is now presented as an optional **Start wait timer** / **Track my actual wait** flow. It is only for a driver physically at the wash who wants to contribute a stronger verified actual-wait sample. It is not required for browsing, reporting, ranking or other users to benefit from WashRadar.

Completed verified wait timers are deliberately stronger evidence than quick reports, but the product must work even when only a small fraction of drivers use them.

## Implemented in the pre-native hardening branch

- Known public/account routes receive real static GitHub Pages entry points so direct navigation returns HTTP 200 after deployment rather than relying only on 404.html SPA recovery.
- `/account-deletion` provides in-product self-service deletion and a public web resource suitable for store account-deletion disclosure.
- `account-actions` provides authenticated deletion, while business-owner accounts are stopped for manual transfer/closure review.
- Unsigned read-only guests no longer call contributor metrics RPCs unnecessarily.
- Queue-session wording makes the verified wait timer optional and removes duplicate completion actions.
- The timer display catches up when the web app resumes from the background; the server remains the source of truth for the session start timestamp.
- Large wash-card lists use `content-visibility` so off-screen cards avoid unnecessary layout/paint work without changing ranking or search result count.
- Main mobile actions are hardened toward 44px touch targets.
- Static ODA autocomplete can use `VITE_ADDRESS_INDEX_BASE`; native builds should use `https://washradar.ca/address-index/` rather than bundling the GTA address dataset into each app release.
- Shared Edge Function CORS includes common Capacitor/Ionic local origins for the upcoming native shell.
- The synthetic-user UX scanner now records a critical failure if the scan itself crashes and checks native-style 44px touch targets.
- Auth documentation now reflects the friends-beta state, account deletion and native requirements.

## Still required before public App Store / Play release

These items need the native-app phase, external configuration, credentials or physical-device verification rather than being safe to finish solely in this web hardening PR:

- Capacitor iOS and Android projects and signing configuration.
- Secure native token/session storage and native auth deep links.
- Native Maps hand-off implementation and device verification.
- APNs/FCM push delivery if background queue alerts are offered; current beta queue targets remain in-app.
- Reliable custom SMTP and end-to-end password recovery before exposing forgot-password broadly.
- Supabase leaked-password protection when supported/configured for the project.
- Production crash/error telemetry with a real configured DSN/project.
- VoiceOver, TalkBack, Dynamic Type/font scaling, keyboard, safe-area, back-button and lifecycle testing on physical devices.
- A controlled transactional test of Update queue -> second client observes update -> verified wait timer -> completion/reward, plus at least one real-wash physical test. Synthetic production tests stay read-only and must not seed fake public queue data.
- Re-deploy existing Edge Functions with native-origin CORS during the Capacitor phase; changing the shared source file does not retroactively change already-deployed function bundles.

## Release gate

Do not submit WashRadar to either store until:

1. CI/build/tests pass for the pre-native hardening release.
2. Post-deploy production and synthetic-user audits pass against the deployed release.
3. Core queue contribution behavior is verified with real independent sessions.
4. Account deletion is tested with a disposable account.
5. Native lifecycle/location/auth flows pass on at least one real iPhone and one real Android device.
