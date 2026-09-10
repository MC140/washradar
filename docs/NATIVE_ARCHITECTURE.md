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
- remote static address-index transport/cache;
- push notifications only if background queue alerts ship;
- platform safe areas/status/navigation-bar integration.

The ODA address chunks should remain remotely updateable rather than inflating every binary/store update. `VITE_ADDRESS_INDEX_BASE` supports a dedicated remote base, but the native implementation must fetch it through a native HTTP bridge/cache or a static endpoint that explicitly permits the native WebView origin. Do not assume ordinary cross-origin browser `fetch()` to GitHub Pages will have the required CORS headers.

Verified wait timers remain optional. The native app should restore the server-backed active session on launch/resume and obtain a fresh location when verification is required. Always-on background GPS is not a v1 requirement.
