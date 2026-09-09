import {createClient} from '@supabase/supabase-js';
import {appConfig} from '../config/env';

// One browser auth client for the entire app.
// Keeping a single instance avoids competing in-memory auth sessions while preserving
// Supabase's existing localStorage session key, so currently signed-in users do not need
// to sign in again just because this implementation changed.
export const supabaseClient = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {params: {eventsPerSecond: 2}},
});
