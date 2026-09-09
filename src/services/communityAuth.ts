import {createClient} from '@supabase/supabase-js';
import {appConfig} from '../config/env';

const client = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
  auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true},
});

export async function beginCommunitySignIn(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error('Enter your email address.');
  const redirectTo = new URL('auth/confirm', window.location.href).toString();
  const {data: {session}} = await client.auth.getSession();

  if (session?.user?.is_anonymous) {
    const {error: upgradeError} = await client.auth.updateUser({email: normalized}, {emailRedirectTo: redirectTo});
    if (!upgradeError) return {preservesContributorId: true};
  }

  const {error} = await client.auth.signInWithOtp({email: normalized, options: {emailRedirectTo: redirectTo}});
  if (error) throw new Error(error.message);
  return {preservesContributorId: false};
}
