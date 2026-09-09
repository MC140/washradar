import type {Session} from '@supabase/supabase-js';
import {appConfig} from '../config/env';
import {supabaseClient as client} from './supabaseClient';

export type CommunityAuthState = {signedIn: boolean; email: string | null};

function stateFromSession(session: Session | null): CommunityAuthState {
  const user = session?.user;
  return {
    signedIn: Boolean(user && !user.is_anonymous),
    email: user && !user.is_anonymous ? user.email ?? null : null,
  };
}

function authRedirectUrl() {
  const basePath = appConfig.basePath === '/' ? '' : appConfig.basePath.replace(/\/$/, '');
  return new URL(`${basePath}/auth/confirm`, window.location.origin).toString();
}

export async function getCommunityAuthState(): Promise<CommunityAuthState> {
  const {data: {session}} = await client.auth.getSession();
  return stateFromSession(session);
}

export function subscribeCommunityAuth(onChange: (state: CommunityAuthState) => void) {
  const {data: {subscription}} = client.auth.onAuthStateChange((_event, session) => {
    onChange(stateFromSession(session));
  });
  return () => subscription.unsubscribe();
}

export async function beginCommunitySignIn(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error('Enter your email address.');
  const redirectTo = authRedirectUrl();
  const {data: {session}} = await client.auth.getSession();

  if (session?.user && !session.user.is_anonymous) {
    if (session.user.email?.toLowerCase() === normalized) {
      return {preservesContributorId: true, alreadySignedIn: true};
    }
    throw new Error('Sign out before switching to a different email address.');
  }

  if (session?.user?.is_anonymous) {
    const {error: upgradeError} = await client.auth.updateUser({email: normalized}, {emailRedirectTo: redirectTo});
    if (!upgradeError) return {preservesContributorId: true, alreadySignedIn: false};
  }

  const {error} = await client.auth.signInWithOtp({
    email: normalized,
    options: {emailRedirectTo: redirectTo, shouldCreateUser: true},
  });
  if (error) throw new Error(error.message);
  return {preservesContributorId: false, alreadySignedIn: false};
}

export async function signOutCommunity() {
  const {error} = await client.auth.signOut();
  if (error) throw new Error(error.message);
}
