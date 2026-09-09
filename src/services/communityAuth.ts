import {createClient, type Provider, type Session} from '@supabase/supabase-js';
import {appConfig} from '../config/env';
import {supabaseClient as client} from './supabaseClient';

export type CommunityAuthState = {signedIn: boolean; email: string | null};
export type AuthCapabilities = {email: boolean; google: boolean; apple: boolean};
export type SocialProvider = 'google' | 'apple';

const EMAIL_SEND_COOLDOWN_MS = 60_000;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const MERGE_CLAIM_KEY = 'wr-auth-merge-claim';
let capabilityPromise: Promise<AuthCapabilities> | null = null;

function stateFromSession(session: Session | null): CommunityAuthState {
  const user = session?.user;
  return {
    signedIn: Boolean(user && !user.is_anonymous),
    email: user && !user.is_anonymous ? user.email ?? null : null,
  };
}

function authRedirectUrl(mode: 'signup' | 'recovery' | 'oauth' = 'signup') {
  const basePath = appConfig.basePath === '/' ? '' : appConfig.basePath.replace(/\/$/, '');
  const url = new URL(`${basePath}/auth/confirm`, window.location.origin);
  url.searchParams.set('mode', mode);
  return url.toString();
}

export function normalizeAuthEmail(email: string) {
  return email.trim().toLowerCase();
}

function assertPassword(password: string) {
  if (password.length < 12) throw new Error('Use at least 12 characters for your password.');
  if (password.length > 128) throw new Error('Password is too long.');
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error('Use uppercase and lowercase letters, a number, and a symbol in your password.');
  }
}

function cooldownKey(email: string) {
  return `wr-auth-email-cooldown:${normalizeAuthEmail(email)}`;
}

function setCooldown(email: string, duration = EMAIL_SEND_COOLDOWN_MS) {
  localStorage.setItem(cooldownKey(email), String(Date.now() + duration));
}

export function getSignInCooldownSeconds(email: string) {
  const normalized = normalizeAuthEmail(email);
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
  if (seconds > 0) throw new Error(`An account email was just requested. Please wait ${seconds}s before asking for another.`);
}

function emailAuthError(error: unknown, email: string) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429')) {
    setCooldown(email, RATE_LIMIT_COOLDOWN_MS);
    return new Error('Too many account emails were requested. Please wait a few minutes and use the newest WashRadar email if one already arrived.');
  }
  return new Error(message || 'Account email is temporarily unavailable.');
}

function passwordAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
    return new Error('Email or password is incorrect. If you previously used an email sign-in link, choose “Forgot / create password” once to set a password.');
  }
  if (lower.includes('email not confirmed') || lower.includes('email_not_confirmed')) {
    return new Error('Verify your email first, then sign in with your password.');
  }
  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429')) {
    return new Error('Too many sign-in attempts. Please wait a few minutes and try again.');
  }
  return new Error(message || 'Sign-in is temporarily unavailable.');
}

function socialAuthError(error: unknown, provider: SocialProvider) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  if (lower.includes('provider is not enabled') || lower.includes('unsupported provider')) {
    return new Error(`${provider === 'google' ? 'Google' : 'Apple'} sign-in is not configured yet.`);
  }
  return new Error(message || `${provider === 'google' ? 'Google' : 'Apple'} sign-in is temporarily unavailable.`);
}

function probeClient() {
  return createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
    auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
  });
}

async function prepareAnonymousMerge() {
  const {data: {session}} = await client.auth.getSession();
  if (!session?.user?.is_anonymous) return null;
  const {data, error} = await client.rpc('prepare_anonymous_contribution_merge');
  if (error) throw new Error('Your guest contribution history could not be prepared safely. Please try again.');
  const token = typeof data === 'string' ? data : null;
  if (token) localStorage.setItem(MERGE_CLAIM_KEY, token);
  return token;
}

export async function claimPendingAnonymousContributions() {
  const token = localStorage.getItem(MERGE_CLAIM_KEY);
  if (!token) return false;
  const {data: {session}} = await client.auth.getSession();
  if (!session?.user || session.user.is_anonymous) return false;
  const {error} = await client.rpc('claim_anonymous_contributions', {p_claim_token: token});
  if (error) {
    const lower = error.message.toLowerCase();
    if (lower.includes('invalid or expired') || lower.includes('claim is invalid')) localStorage.removeItem(MERGE_CLAIM_KEY);
    else console.warn('WashRadar contributor-history merge will retry.', error.message);
    return false;
  }
  localStorage.removeItem(MERGE_CLAIM_KEY);
  return true;
}

async function adoptSession(session: Session) {
  const {error} = await client.auth.setSession({access_token: session.access_token, refresh_token: session.refresh_token});
  if (error) throw new Error(error.message);
  await claimPendingAnonymousContributions();
}

export async function getCommunityAuthState(): Promise<CommunityAuthState> {
  const {data: {session}} = await client.auth.getSession();
  if (session?.user && !session.user.is_anonymous) void claimPendingAnonymousContributions();
  return stateFromSession(session);
}

export function subscribeCommunityAuth(onChange: (state: CommunityAuthState) => void) {
  const {data: {subscription}} = client.auth.onAuthStateChange((_event, session) => {
    onChange(stateFromSession(session));
    if (session?.user && !session.user.is_anonymous) setTimeout(() => void claimPendingAnonymousContributions(), 0);
  });
  return () => subscription.unsubscribe();
}

export async function getAuthCapabilities(): Promise<AuthCapabilities> {
  if (capabilityPromise) return capabilityPromise;
  capabilityPromise = (async () => {
    if (!appConfig.supabaseUrl || !appConfig.supabasePublishableKey) return {email: false, google: false, apple: false};
    try {
      const response = await fetch(`${appConfig.supabaseUrl}/auth/v1/settings`, {
        headers: {apikey: appConfig.supabasePublishableKey},
      });
      if (!response.ok) throw new Error('Auth settings unavailable.');
      const settings = await response.json() as {external?: Record<string, boolean>};
      return {
        email: settings.external?.email !== false,
        google: settings.external?.google === true,
        apple: settings.external?.apple === true,
      };
    } catch {
      return {email: true, google: false, apple: false};
    }
  })();
  return capabilityPromise;
}

export async function signInWithPassword(email: string, password: string) {
  const normalized = normalizeAuthEmail(email);
  if (!normalized) throw new Error('Enter your email address.');
  if (!password) throw new Error('Enter your password.');

  await prepareAnonymousMerge();
  const auth = probeClient();
  const {data, error} = await auth.auth.signInWithPassword({email: normalized, password});
  if (error || !data.session) throw passwordAuthError(error);
  await adoptSession(data.session);
  return {email: data.user.email ?? normalized};
}

export async function signUpWithPassword(email: string, password: string) {
  const normalized = normalizeAuthEmail(email);
  if (!normalized) throw new Error('Enter your email address.');
  assertPassword(password);
  assertCanSend(normalized);
  await prepareAnonymousMerge();

  const auth = probeClient();
  const {data, error} = await auth.auth.signUp({
    email: normalized,
    password,
    options: {emailRedirectTo: authRedirectUrl('signup')},
  });
  if (error) throw emailAuthError(error, normalized);
  setCooldown(normalized);

  if (data.session) {
    await adoptSession(data.session);
    return {confirmationRequired: false};
  }
  return {confirmationRequired: true};
}

export async function requestPasswordReset(email: string) {
  const normalized = normalizeAuthEmail(email);
  if (!normalized) throw new Error('Enter your email address first.');
  assertCanSend(normalized);
  await prepareAnonymousMerge();
  const {error} = await client.auth.resetPasswordForEmail(normalized, {redirectTo: authRedirectUrl('recovery')});
  if (error) throw emailAuthError(error, normalized);
  setCooldown(normalized);
}

export async function updateAccountPassword(password: string) {
  assertPassword(password);
  const {data: {session}} = await client.auth.getSession();
  if (!session?.user || session.user.is_anonymous) throw new Error('Open the newest WashRadar recovery email first.');
  const {error} = await client.auth.updateUser({password});
  if (error) throw new Error(error.message || 'Password could not be updated.');
  await claimPendingAnonymousContributions();
}

export async function signInWithSocial(provider: SocialProvider) {
  const capabilities = await getAuthCapabilities();
  if (!capabilities[provider]) throw new Error(`${provider === 'google' ? 'Google' : 'Apple'} sign-in is not configured yet.`);
  await prepareAnonymousMerge();
  const {error} = await client.auth.signInWithOAuth({
    provider: provider as Provider,
    options: {redirectTo: authRedirectUrl('oauth')},
  });
  if (error) throw socialAuthError(error, provider);
}

export async function beginCommunitySignIn(email: string): Promise<never> {
  if (!normalizeAuthEmail(email)) throw new Error('Enter your email address.');
  throw new Error('Use email + password to sign in.');
}

export async function signOutCommunity() {
  localStorage.removeItem(MERGE_CLAIM_KEY);
  const {error} = await client.auth.signOut();
  if (error) throw new Error(error.message);
}
