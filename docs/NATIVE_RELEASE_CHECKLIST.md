# WashRadar native release checklist

Use this checklist for the future Capacitor iOS/Android release. Web production remains the source baseline until these gates pass.

## Core product

- [ ] Update queue remains the primary contribution action.
- [ ] Optional verified wait timer starts only when fresh GPS confirms the driver is at the wash.
- [ ] Active wait timer restores after app background/termination from the server-backed session.
- [ ] User can explicitly mark when the wash starts; no always-on background location is required for v1.
- [ ] Two independent devices verify that a queue update propagates into the displayed wait/cars-ahead state.
- [ ] Verified completed wait updates history/rewards exactly once.

## Accounts and privacy

- [ ] Account creation/login/logout works on iOS and Android.
- [ ] `/account-deletion` is publicly reachable with HTTP 200.
- [ ] In-app account deletion works using a disposable account.
- [ ] Business-owner deletion is stopped for ownership review.
- [ ] Privacy policy accurately describes native permissions and data retention.
- [ ] Custom SMTP and password recovery are verified before recovery UI is enabled.
- [ ] Leaked-password protection is enabled when supported/configured.

## Native platform

- [ ] Capacitor iOS project builds and signs.
- [ ] Capacitor Android project builds and signs.
- [ ] Native secure storage is used for sensitive persisted auth/session material.
- [ ] Auth callback/deep links work from email/social providers.
- [ ] Directions launches the intended installed Maps app cleanly.
- [ ] Native geolocation permission copy and denial recovery are tested.
- [ ] APNs/FCM are configured only if background queue alerts are included in v1.
- [ ] Native WebView origins are allowed by every Edge Function the app invokes.

## Quality

- [ ] Latest quality workflow passes.
- [ ] Latest post-deploy production audit passes.
- [ ] Latest synthetic-user agent passes with no unexplained warnings.
- [ ] Production crash/error telemetry is configured.
- [ ] VoiceOver test passes on iPhone.
- [ ] TalkBack test passes on Android.
- [ ] Dynamic text/font scaling does not clip timing/cards/actions.
- [ ] Safe areas work on notched iPhones and gesture-navigation Android devices.
- [ ] Android hardware/system back behavior is correct.
- [ ] App resume after lock/background restores location/result/wait-timer state safely.
- [ ] At least one real car-wash end-to-end test is completed.
