import production from './production.json';
const raw = import.meta.env;

export const appConfig = {
  appName: raw.VITE_APP_NAME || 'WashRadar',
  basePath: raw.BASE_URL || '/',
  demoMode: raw.VITE_DEMO_MODE === 'true' || (raw.DEV && !raw.VITE_SUPABASE_URL),
  supabaseUrl: raw.VITE_SUPABASE_URL || production.supabaseUrl,
  supabasePublishableKey: raw.VITE_SUPABASE_PUBLISHABLE_KEY || production.supabasePublishableKey,
  googleMapsBrowserKey: raw.VITE_GOOGLE_MAPS_BROWSER_KEY || '',
  mapTileUrl: raw.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  mapAttribution: raw.VITE_MAP_ATTRIBUTION || '© OpenStreetMap contributors',
  supportEmail: raw.VITE_SUPPORT_EMAIL || 'support@washradar.ca',
  sentryDsn: raw.VITE_SENTRY_DSN || '',
};

export const hasSupabaseConfiguration = Boolean(appConfig.supabaseUrl && appConfig.supabasePublishableKey);
