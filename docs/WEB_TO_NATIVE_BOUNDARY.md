# Web-to-native responsibility boundary

Keep product/domain behavior in the shared React application. Add native adapters only around capabilities that depend on the host platform.

Shared/web-owned:
- wash discovery/ranking;
- queue estimates and cars-ahead presentation;
- quick queue reports;
- verified wait-session API semantics;
- account/profile/challenge UI;
- ODA/static address lookup;
- Supabase repositories.

Native-adapter-owned:
- geolocation permission/request APIs;
- app foreground/background lifecycle;
- secure storage for persisted auth material;
- deep links/auth callbacks;
- Maps app launching;
- APNs/FCM tokens and notification actions if enabled;
- safe-area/status/navigation integration.

This boundary prevents two separate implementations of WashRadar from drifting between web, iOS and Android.
