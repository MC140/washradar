import type {AdCreative, Point} from '../domain/models';
import {clientId} from './repository';
import {supabaseClient} from './supabaseClient';

// This is only a defensive transport ceiling. The commercial inventory limit is enforced
// per placement in Supabase so it can change without a frontend release.
const MAX_AD_REQUEST_LIMIT = 20;

export async function loadLocalAds(placement: string, origin: Point, limit = MAX_AD_REQUEST_LIMIT, washId?: string): Promise<AdCreative[]> {
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return [];
  const safeLimit = Math.max(1, Math.min(MAX_AD_REQUEST_LIMIT, Math.floor(limit || MAX_AD_REQUEST_LIMIT)));
  const {data, error} = await supabaseClient.functions.invoke('ad-events', {
    body: {
      action: 'select',
      placement,
      lat: origin.lat,
      lng: origin.lng,
      clientId: clientId(),
      limit: safeLimit,
      washId,
    },
  });
  if (error || !Array.isArray(data?.ads)) return [];
  return (data.ads as AdCreative[]).slice(0, safeLimit);
}
