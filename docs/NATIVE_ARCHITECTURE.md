# WashRadar native architecture direction

WashRadar should not be rewritten in React Native for the first iOS/Android release. The intended path is to wrap the existing React + Vite application with Capacitor and bridge only platform-dependent capabilities.

Reuse unchanged where practical:
- ranking/queue domain logic;
- Supabase data model and APIs;
- Explore/cards/details/profile/challenges/vehicles UI;
- static ODA address search model;
- guest-first contribution model;
- browser/PWA production as the web baseline.

Native bridges required:
- foreground geolocation and permission state;
- app lifecycle/resume events;
- secure session/token persistence;
- auth deep links;
- external Maps app launch;
- push notifications only if background queue alerts ship;
- platform safe areas/status/navigation-bar integration.

The native app should configure `VITE_ADDRESS_INDEX_BASE=https://washradar.ca/address-index/` so address chunks stay remotely updateable and do not inflate every binary/store update.

Verified wait timers remain optional. The native app should restore the server-backed active session on launch/resume and obtain a fresh location when verification is required. Always-on background GPS is not a v1 requirement.
