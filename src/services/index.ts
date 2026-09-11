import type {AdCreative, Point} from '../domain/models';
import {appConfig, hasSupabaseConfiguration} from '../config/env';
import {DemoRepository} from './demoRepository';
import {SupabaseRepository} from './supabaseRepository';
import {loadLocalAds} from './ads';
import {UnavailableRepository, type ContributionMetrics, type WashRepository} from './repository';
import {supabaseClient} from './supabaseClient';

const emptyMetrics: ContributionMetrics = {reportsSubmitted: 0, completedWaits: 0, reputation: 50, streakDays: 0};
const supabaseRepository = new SupabaseRepository();
const loadSupabaseMetrics = supabaseRepository.metrics.bind(supabaseRepository);
const MAX_AD_REQUEST_LIMIT = 20;

// A normal browser visitor has no Supabase auth session until they contribute or sign in.
// Avoid sending an RPC that can only describe a contributor in that state; this removes
// a noisy 401 from every read-only guest journey without creating anonymous users early.
supabaseRepository.metrics = async () => {
  const {data: {session}} = await supabaseClient.auth.getSession();
  return session ? loadSupabaseMetrics() : emptyMetrics;
};

// Route single-ad callers through the same server-hashed, radius-only selector used by
// the multi-ad inventory so Details and cached placements share the same targeting rules.
supabaseRepository.getAd = async (placement, origin, washId) => {
  const ads = await loadLocalAds(placement, origin, 1, washId);
  return ads[0] ?? null;
};

export const repository: WashRepository = appConfig.demoMode
  ? new DemoRepository()
  : hasSupabaseConfiguration
    ? supabaseRepository
    : new UnavailableRepository();

export async function getNearbyAds(placement: string, origin: Point, limit = MAX_AD_REQUEST_LIMIT, washId?: string): Promise<AdCreative[]> {
  const safeLimit = Math.max(1, Math.min(MAX_AD_REQUEST_LIMIT, Math.floor(limit || MAX_AD_REQUEST_LIMIT)));
  if (repository.mode === 'supabase') return loadLocalAds(placement, origin, safeLimit, washId);
  if (repository.mode !== 'demo') return [];

  const ads: AdCreative[] = [];
  const seenBusinesses = new Set<string>();
  for (let attempt = 0; attempt < safeLimit * 2 && ads.length < safeLimit; attempt++) {
    const ad = await repository.getAd(placement, origin, washId);
    if (!ad) break;
    if (seenBusinesses.has(ad.businessName)) continue;
    seenBusinesses.add(ad.businessName);
    ads.push(ad);
  }
  return ads;
}
