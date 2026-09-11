import type {AdCreative, Point} from '../domain/models';
import {clientId} from './repository';
import {supabaseClient} from './supabaseClient';

const MAX_LOCAL_ADS = 5;

export async function loadLocalAds(placement: string, origin: Point, limit = MAX_LOCAL_ADS, washId?: string): Promise<AdCreative[]> {
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return [];
  const safeLimit = Math.max(1, Math.min(MAX_LOCAL_ADS, Math.floor(limit || MAX_LOCAL_ADS)));
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
