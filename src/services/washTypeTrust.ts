import {createClient} from '@supabase/supabase-js';
import {QUEUE_CONFIG} from '../domain/config';
import type {WashType} from '../domain/models';
import {appConfig} from '../config/env';
import {requestLocation} from './location';
import {clientId} from './repository';

const client = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
  auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true},
});

async function ensureContributor() {
  const {data: {session}} = await client.auth.getSession();
  if (!session) {
    const {error} = await client.auth.signInAnonymously();
    if (error) throw new Error('Wash-type contributions are temporarily unavailable.');
  }
}

async function errorMessage(error: unknown, fallback: string) {
  const context = (error as {context?: unknown} | null)?.context;
  if (typeof Response !== 'undefined' && context instanceof Response) {
    try {
      const body = await context.clone().json() as {error?: unknown};
      if (typeof body.error === 'string' && body.error.trim()) return body.error;
    } catch {
      // Use fallback below.
    }
  }
  return fallback;
}

export async function submitWashTypeContribution(washId: string, washTypes: WashType[]) {
  if (!washTypes.length) throw new Error('Choose at least one wash type.');
  await ensureContributor();

  let position: {lat: number; lng: number} | undefined;
  try {
    const location = await requestLocation();
    if (location.accuracy <= QUEUE_CONFIG.maximumAccurateGpsMetres) position = location.point;
  } catch {
    position = undefined;
  }

  const {data, error} = await client.functions.invoke('wash-type-actions', {
    body: {action: 'report', washId, washTypes: [...new Set(washTypes)], clientId: clientId(), ...(position ? {position} : {})},
  });
  if (error) throw new Error(await errorMessage(error, 'Wash-type contribution could not be saved.'));
  if (data?.error) throw new Error(data.error);
  return data as {verification: 'nearby' | 'remote'; truth: {wash_type: WashType; confidence_score: number; source_label: string}[]};
}

export type WashTypeEnrichmentProgress = {
  processed: number;
  classified: number;
  websiteMatches: number;
  reviewMatches: number;
  nextOffset: number | null;
};

export async function enrichWashTypes(onProgress?: (progress: WashTypeEnrichmentProgress) => void) {
  const stored = Number(localStorage.getItem('wr-type-enrich-offset') ?? '0');
  let offset = Number.isFinite(stored) && stored >= 0 ? stored : 0;
  let totalProcessed = 0;
  let totalClassified = 0;
  let totalWebsiteMatches = 0;
  let totalReviewMatches = 0;

  while (true) {
    const {data, error} = await client.functions.invoke('wash-type-actions', {body: {action: 'enrich', offset, limit: 5}});
    const partial = data as Partial<WashTypeEnrichmentProgress> | null;
    if (error || data?.error) {
      const next = typeof partial?.nextOffset === 'number' ? partial.nextOffset : offset;
      localStorage.setItem('wr-type-enrich-offset', String(next));
      throw new Error(data?.error || await errorMessage(error, 'Wash-type enrichment stopped.'));
    }

    totalProcessed += Number(data?.processed ?? 0);
    totalClassified += Number(data?.classified ?? 0);
    totalWebsiteMatches += Number(data?.websiteMatches ?? 0);
    totalReviewMatches += Number(data?.reviewMatches ?? 0);
    const nextOffset = data?.nextOffset === null || data?.nextOffset === undefined ? null : Number(data.nextOffset);

    onProgress?.({
      processed: totalProcessed,
      classified: totalClassified,
      websiteMatches: totalWebsiteMatches,
      reviewMatches: totalReviewMatches,
      nextOffset,
    });

    if (nextOffset === null) {
      localStorage.removeItem('wr-type-enrich-offset');
      return {processed: totalProcessed, classified: totalClassified, websiteMatches: totalWebsiteMatches, reviewMatches: totalReviewMatches};
    }
    offset = nextOffset;
    localStorage.setItem('wr-type-enrich-offset', String(offset));
  }
}
