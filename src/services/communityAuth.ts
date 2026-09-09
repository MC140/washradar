import type {Session} from '@supabase/supabase-js';
import {appConfig} from '../config/env';
import {supabaseClient as client} from './supabaseClient';

export type CommunityAuthState = {signedIn: boolean; email: string | null};

const EMAIL_SEND_COOLDOWN_MS = 60_000;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;

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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function cooldownKey(email: string) {
  return `wr-auth-email-cooldown:${normalizeEmail(email)}`;
}

function existingAccountFallbackKey(email: string) {
  return `wr-auth-email-existing:${normalizeEmail(email)}`;
}

function setCooldown(email: string, duration = EMAIL_SEND_COOLDOWN_MS) {
  localStorage.setItem(cooldownKey(email), String(Date.now() + duration));
}

export function getSignInCooldownSeconds(email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) return 0;
  const until = Number(localStorage.getItem(cooldownKey(normalized)) ?? 0);
  if (!Number.isFinite(until) || until <= Date.now()) {
    localStorage.removeItem(cooldownKey(normalized));
    return 0;
  }
  return Math.max(1, Math.ceil((until - Date.now()) / 1000));
}

function assertCanSend(email: string) {
  const seconds = getSignInCooldownSeconds(email);
  if (seconds > 0) throw new Error(`A sign-in email was just requested. Please wait ${seconds}s before asking for another.`);
}

function authError(error: unknown, email: string) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429')) {
    setCooldown(email, RATE_LIMIT_COOLDOWN_MS);
    return new Error('Too many sign-in emails were requested. Please wait a few minutes. If a WashRadar email already arrived, use the newest link instead of requesting another.');
  }
  return new Error(message || 'Sign-in is temporarily unavailable.');
}

function emailAlreadyRegistered(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
  return message.includes('already registered') || message.includes('already exists') || message.includes('email exists') || message.includes('user already exists');
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
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('Enter your email address.');
  const redirectTo = authRedirectUrl();
  const {data: {session}} = await client.auth.getSession();

  if (session?.user && !session.user.is_anonymous) {
    if (session.user.email?.toLowerCase() === normalized) {
      return {preservesContributorId: true, alreadySignedIn: true};
    }
    throw new Error('Sign out before switching to a different email address.');
  }

  assertCanSend(normalized);

  if (session?.user?.is_anonymous && localStorage.getItem(existingAccountFallbackKey(normalized)) !== 'true') {
    const {error: upgradeError} = await client.auth.updateUser({email: normalized}, {emailRedirectTo: redirectTo});
    if (!upgradeError) {
      setCooldown(normalized);
      return {preservesContributorId: true, alreadySignedIn: false};
    }

    if (emailAlreadyRegistered(upgradeError)) {
      localStorage.setItem(existingAccountFallbackKey(normalized), 'true');
      throw new Error('That email already has a WashRadar account. Tap Continue with email once more to sign in to that existing account.');
    }

    throw authError(upgradeError, normalized);
  }

  const {error} = await client.auth.signInWithOtp({
    email: normalized,
    options: {emailRedirectTo: redirectTo, shouldCreateUser: true},
  });
  if (error) throw authError(error, normalized);
  setCooldown(normalized);
  return {preservesContributorId: false, alreadySignedIn: false};
}

export async function signOutCommunity() {
  const {error} = await client.auth.signOut();
  if (error) throw new Error(error.message);
}
