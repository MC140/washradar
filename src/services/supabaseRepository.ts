import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {appConfig} from '../config/env';
import type {AdCreative, BusinessHours, CarWash, Point, QueueAlert, QueueReportInput, QueueSession, QueueSignal, WashPackage, WashType} from '../domain/models';
import {clientId, readJson, type AdminSnapshot, type CatalogueImportProgress, type CatalogueImportResult, type ContributionMetrics, type WashRepository} from './repository';

type DirectoryRow = {
  id: string;
  name: string;
  address_line: string;
  city: string;
  region_name: string;
  country_name: string;
  postal_code: string;
  latitude: number;
  longitude: number;
  operating_status: CarWash['status'];
  rating: number | null;
  rating_count: number;
  estimated_wash_minutes: number;
  minutes_per_car: number;
  historical_wait_minutes: number;
  historical_sample_count: number;
  source_updated_at: string | null;
  wash_types: WashType[];
  packages: WashPackage[];
  hours: BusinessHours[];
  amenities: string[];
};

type DiscoveryArea = {name: string; lat: number; lng: number; radiusMetres: number};

// 50 overlapping cells cover the practical GTA test footprint while keeping each
// Places Nearby request small enough to reduce the chance of hitting the 20-result cap.
// Re-running is safe because wash-ingest de-duplicates by Google Place ID.
const GTA_DISCOVERY_AREAS: DiscoveryArea[] = [
  {name: 'Toronto Downtown West', lat: 43.648, lng: -79.430, radiusMetres: 5000},
  {name: 'Toronto Downtown East', lat: 43.654, lng: -79.355, radiusMetres: 5000},
  {name: 'Toronto Midtown West', lat: 43.686, lng: -79.430, radiusMetres: 5000},
  {name: 'Toronto Midtown East', lat: 43.704, lng: -79.365, radiusMetres: 5000},
  {name: 'Etobicoke South', lat: 43.620, lng: -79.535, radiusMetres: 6000},
  {name: 'Etobicoke North', lat: 43.722, lng: -79.565, radiusMetres: 6000},
  {name: 'York', lat: 43.692, lng: -79.480, radiusMetres: 5000},
  {name: 'North York West', lat: 43.758, lng: -79.505, radiusMetres: 5500},
  {name: 'North York Central', lat: 43.769, lng: -79.414, radiusMetres: 5500},
  {name: 'North York East', lat: 43.773, lng: -79.335, radiusMetres: 5500},
  {name: 'Scarborough West', lat: 43.735, lng: -79.275, radiusMetres: 5500},
  {name: 'Scarborough Central', lat: 43.776, lng: -79.257, radiusMetres: 5500},
  {name: 'Scarborough East', lat: 43.784, lng: -79.175, radiusMetres: 5500},
  {name: 'Scarborough South', lat: 43.718, lng: -79.245, radiusMetres: 5500},
  {name: 'Toronto Beaches', lat: 43.680, lng: -79.300, radiusMetres: 5000},

  {name: 'Mississauga East', lat: 43.625, lng: -79.610, radiusMetres: 6000},
  {name: 'Mississauga Central', lat: 43.590, lng: -79.645, radiusMetres: 6000},
  {name: 'Mississauga West', lat: 43.574, lng: -79.720, radiusMetres: 6000},
  {name: 'Mississauga North', lat: 43.650, lng: -79.700, radiusMetres: 6000},
  {name: 'Clarkson Port Credit', lat: 43.536, lng: -79.640, radiusMetres: 6000},

  {name: 'Brampton Southeast', lat: 43.690, lng: -79.730, radiusMetres: 6000},
  {name: 'Brampton Central', lat: 43.731, lng: -79.762, radiusMetres: 6000},
  {name: 'Brampton West', lat: 43.724, lng: -79.835, radiusMetres: 6000},
  {name: 'Brampton North', lat: 43.785, lng: -79.770, radiusMetres: 6500},
  {name: 'Bolton', lat: 43.879, lng: -79.738, radiusMetres: 7000},
  {name: 'Caledon South', lat: 43.836, lng: -79.880, radiusMetres: 7500},

  {name: 'Oakville East', lat: 43.457, lng: -79.660, radiusMetres: 6000},
  {name: 'Oakville Central', lat: 43.467, lng: -79.700, radiusMetres: 6000},
  {name: 'Oakville North', lat: 43.500, lng: -79.735, radiusMetres: 6500},
  {name: 'Burlington East', lat: 43.365, lng: -79.760, radiusMetres: 6500},
  {name: 'Burlington Central', lat: 43.345, lng: -79.800, radiusMetres: 6500},
  {name: 'Burlington North', lat: 43.390, lng: -79.825, radiusMetres: 7000},
  {name: 'Milton East', lat: 43.515, lng: -79.835, radiusMetres: 7000},
  {name: 'Milton West', lat: 43.525, lng: -79.900, radiusMetres: 7000},

  {name: 'Vaughan West', lat: 43.795, lng: -79.600, radiusMetres: 6000},
  {name: 'Vaughan Central', lat: 43.827, lng: -79.535, radiusMetres: 6000},
  {name: 'Vaughan East', lat: 43.810, lng: -79.470, radiusMetres: 6000},
  {name: 'Richmond Hill South', lat: 43.845, lng: -79.430, radiusMetres: 6000},
  {name: 'Richmond Hill North', lat: 43.900, lng: -79.440, radiusMetres: 6000},
  {name: 'Markham West', lat: 43.840, lng: -79.355, radiusMetres: 6000},
  {name: 'Markham Central', lat: 43.856, lng: -79.265, radiusMetres: 6000},
  {name: 'Markham East', lat: 43.885, lng: -79.190, radiusMetres: 6500},
  {name: 'Aurora', lat: 44.000, lng: -79.468, radiusMetres: 7000},
  {name: 'Newmarket', lat: 44.058, lng: -79.461, radiusMetres: 7000},

  {name: 'Pickering', lat: 43.838, lng: -79.087, radiusMetres: 6500},
  {name: 'Ajax', lat: 43.850, lng: -79.020, radiusMetres: 6500},
  {name: 'Whitby', lat: 43.897, lng: -78.943, radiusMetres: 6500},
  {name: 'Oshawa West', lat: 43.900, lng: -78.865, radiusMetres: 6500},
  {name: 'Oshawa East', lat: 43.915, lng: -78.805, radiusMetres: 6500},
  {name: 'Clarington West', lat: 43.910, lng: -78.700, radiusMetres: 7500},
];

function mapWash(row: DirectoryRow): CarWash {
  return {
    id: row.id,
    name: row.name,
    address: row.address_line,
    city: row.city,
    region: row.region_name,
    country: row.country_name,
    postalCode: row.postal_code,
    position: {lat: Number(row.latitude), lng: Number(row.longitude)},
    types: row.wash_types ?? [],
    packages: row.packages ?? [],
    status: row.operating_status,
    rating: row.rating === null ? null : Number(row.rating),
    ratingCount: row.rating_count ?? 0,
    estimatedWashMinutes: row.estimated_wash_minutes,
    minutesPerCar: Number(row.minutes_per_car),
    historicalWaitMinutes: row.historical_wait_minutes,
    historicalSampleCount: row.historical_sample_count,
    hours: row.hours ?? [],
    amenities: row.amenities ?? [],
    dataEnvironment: 'production',
    sourceUpdatedAt: row.source_updated_at,
  };
}

export class SupabaseRepository implements WashRepository {
  readonly mode = 'supabase' as const;
  private client: SupabaseClient;
  private activeSession: QueueSession | null = null;

  constructor() {
    this.client = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
      auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true},
      realtime: {params: {eventsPerSecond: 2}},
    });
  }

  private async ensureContributor() {
    const {data: {session}} = await this.client.auth.getSession();
    if (!session) {
      const {error} = await this.client.auth.signInAnonymously();
      if (error) throw new Error('Queue contributions are temporarily unavailable.');
    }
  }

  private async functionErrorMessage(error: unknown, fallback: string) {
    const context = (error as {context?: unknown} | null)?.context;
    if (typeof Response !== 'undefined' && context instanceof Response) {
      try {
        const payload = await context.clone().json() as {error?: unknown; message?: unknown};
        if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
        if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
      } catch {
        // Keep the friendly fallback below if the response body is not JSON.
      }
    }
    const message = error instanceof Error ? error.message : '';
    return message && !message.toLowerCase().includes('edge function returned a non-2xx') ? message : fallback;
  }

  async loadWashes(origin: Point, radiusKm = 50) {
    const {data, error} = await this.client.rpc('nearby_washes_json', {p_lat: origin.lat, p_lng: origin.lng, p_radius_km: radiusKm});
    if (error) throw new Error('Nearby washes could not be loaded.');
    const rows = (data ?? []) as DirectoryRow[];
    const ids = rows.map((row) => row.id);
    let signals: QueueSignal[] = [];
    if (ids.length) {
      const response = await this.client.rpc('queue_signal_feed', {p_wash_ids: ids});
      if (!response.error) signals = (response.data ?? []) as QueueSignal[];
    }
    return {washes: rows.map(mapWash), signals};
  }

  async routeTimes(origin: Point, washes: CarWash[]) {
    const destinations = washes.slice(0, 10).map((wash) => ({washId: wash.id, point: wash.position}));
    if (!destinations.length) return {};
    const {data, error} = await this.client.functions.invoke('geo-services', {
      body: {action: 'routes', origin, destinations, clientId: clientId()},
    });
    if (error || !data?.routes) return {};
    return data.routes as Record<string, number>;
  }

  async searchLocation(query: string) {
    const {data, error} = await this.client.functions.invoke('geo-services', {body: {action: 'geocode', query, clientId: clientId()}});
    if (error || !data?.point) return null;
    return {lat: Number(data.point.lat), lng: Number(data.point.lng)};
  }

  subscribe(onChange: () => void) {
    const channel = this.client.channel('queue-estimates-public')
      .on('postgres_changes', {event: '*', schema: 'public', table: 'queue_estimates'}, onChange)
      .subscribe();
    return () => { void this.client.removeChannel(channel); };
  }

  private async queueAction<T>(body: Record<string, unknown>): Promise<T> {
    await this.ensureContributor();
    const {data, error} = await this.client.functions.invoke('queue-actions', {body: {...body, clientId: clientId()}});
    if (error) throw new Error(await this.functionErrorMessage(error, 'That queue action could not be completed.'));
    if (data?.error) throw new Error(data.error);
    return data as T;
  }

  submitReport(input: QueueReportInput) {
    return this.queueAction<{verification: 'nearby' | 'remote'}>({action: 'report', ...input});
  }

  async startQueueSession(washId: string, position?: Point, initialQueueBucket?: QueueSession['initialQueueBucket']) {
    const session = await this.queueAction<QueueSession>({action: 'start', washId, position, initialQueueBucket});
    this.activeSession = session;
    localStorage.setItem('wr-has-queue-session', 'true');
    return session;
  }

  async finishQueueSession(action: 'completed' | 'cancelled') {
    const session = await this.queueAction<QueueSession | null>({action: action === 'completed' ? 'finish' : 'cancel'});
    this.activeSession = null;
    localStorage.removeItem('wr-has-queue-session');
    return session;
  }

  async getActiveQueueSession() {
    if (this.activeSession) return this.activeSession;
    if (localStorage.getItem('wr-has-queue-session') !== 'true') return null;
    await this.ensureContributor();
    this.activeSession = await this.queueAction<QueueSession | null>({action: 'active'});
    if (!this.activeSession) localStorage.removeItem('wr-has-queue-session');
    return this.activeSession;
  }

  private async userId() {
    const {data: {user}} = await this.client.auth.getUser();
    return user?.is_anonymous ? null : user?.id ?? null;
  }

  async getFavouriteIds() {
    const userId = await this.userId();
    if (!userId) return readJson<string[]>('wr-favourites', []);
    const local = readJson<string[]>('wr-favourites', []);
    if (local.length) {
      const {error} = await this.client.from('favourites').upsert(local.map((washId) => ({user_id: userId, wash_id: washId})));
      if (!error) localStorage.removeItem('wr-favourites');
    }
    const {data} = await this.client.from('favourites').select('wash_id').eq('user_id', userId);
    return (data ?? []).map((row) => row.wash_id as string);
  }

  async toggleFavourite(washId: string, saved: boolean) {
    const userId = await this.userId();
    if (!userId) {
      const current = new Set(readJson<string[]>('wr-favourites', []));
      if (saved) current.add(washId);
      else current.delete(washId);
      localStorage.setItem('wr-favourites', JSON.stringify([...current]));
      return;
    }
    if (saved) {
      const {error} = await this.client.from('favourites').upsert({user_id: userId, wash_id: washId});
      if (error) throw error;
    } else {
      const {error} = await this.client.from('favourites').delete().eq('user_id', userId).eq('wash_id', washId);
      if (error) throw error;
    }
  }

  async getAlerts() {
    const userId = await this.userId();
    if (!userId) return readJson<QueueAlert[]>('wr-alerts', []);
    const local = readJson<QueueAlert[]>('wr-alerts', []);
    if (local.length) {
      const {error} = await this.client.from('alerts').upsert(local.map((alert) => ({
        user_id: userId, wash_id: alert.washId, threshold_minutes: alert.thresholdMinutes, enabled: alert.enabled,
      })), {onConflict: 'user_id,wash_id,threshold_minutes'});
      if (!error) localStorage.removeItem('wr-alerts');
    }
    const {data} = await this.client.from('alerts').select('id,wash_id,threshold_minutes,enabled,triggered_at').eq('user_id', userId);
    return (data ?? []).map((row) => ({id: row.id, washId: row.wash_id, thresholdMinutes: row.threshold_minutes, enabled: row.enabled, triggeredAt: row.triggered_at}));
  }

  async createAlert(washId: string, thresholdMinutes: number) {
    const userId = await this.userId();
    if (!userId) {
      const alerts = readJson<QueueAlert[]>('wr-alerts', []);
      const alert = {id: crypto.randomUUID(), washId, thresholdMinutes, enabled: true, triggeredAt: null};
      alerts.push(alert);
      localStorage.setItem('wr-alerts', JSON.stringify(alerts));
      return alert;
    }
    const {data, error} = await this.client.from('alerts').insert({user_id: userId, wash_id: washId, threshold_minutes: thresholdMinutes}).select('id,wash_id,threshold_minutes,enabled,triggered_at').single();
    if (error) throw error;
    return {id: data.id, washId: data.wash_id, thresholdMinutes: data.threshold_minutes, enabled: data.enabled, triggeredAt: data.triggered_at};
  }

  async submitPriceCorrection(washId: string, amount: number | null, note: string) {
    const userId = await this.userId();
    if (!userId) throw new Error('Sign in to submit a price correction.');
    const {error} = await this.client.from('price_corrections').insert({
      wash_id: washId,
      user_id: userId,
      proposed_amount: amount,
      currency: 'CAD',
      note,
    });
    if (error) throw new Error('The price correction could not be submitted.');
  }

  async removeAlert(id: string) {
    const userId = await this.userId();
    if (!userId) {
      localStorage.setItem('wr-alerts', JSON.stringify(readJson<QueueAlert[]>('wr-alerts', []).filter((alert) => alert.id !== id)));
      return;
    }
    const {error} = await this.client.from('alerts').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
  }

  async getAd(placement: string, origin: Point, washId?: string) {
    const {data, error} = await this.client.rpc('select_ad', {
      p_placement_slug: placement,
      p_lat: origin.lat,
      p_lng: origin.lng,
      p_session_hash: clientId(),
      p_wash_id: washId ?? null,
    });
    if (error || !data?.length) return null;
    return data[0] as AdCreative;
  }

  async recordAdEvent(ad: AdCreative, event: 'impression' | 'click', placement: string) {
    await this.client.functions.invoke('ad-events', {body: {creativeId: ad.id, campaignId: ad.campaignId, event, placement, clientId: clientId()}});
  }

  async signInWithEmail(email: string) {
    const redirectTo = new URL('auth/confirm', window.location.href).toString();
    const {error} = await this.client.auth.signInWithOtp({email, options: {emailRedirectTo: redirectTo}});
    if (error) throw new Error(error.message);
  }
  async signOut() { await this.client.auth.signOut(); }
  async authState() {
    const {data: {user}} = await this.client.auth.getUser();
    return {signedIn: Boolean(user && !user.is_anonymous), email: user?.email ?? null};
  }
  async metrics(): Promise<ContributionMetrics> {
    const {data, error} = await this.client.rpc('my_contribution_metrics');
    if (error || !data?.[0]) return {reportsSubmitted: 0, completedWaits: 0, reputation: 50, streakDays: 0};
    return {
      reportsSubmitted: data[0].reports_submitted,
      completedWaits: data[0].completed_waits,
      reputation: data[0].reputation,
      streakDays: data[0].streak_days,
    };
  }
  async adminSnapshot(): Promise<AdminSnapshot> {
    const {data, error} = await this.client.functions.invoke('admin', {body: {action: 'snapshot'}});
    if (error || data?.error) throw new Error(data?.error || 'Administrator access is required.');
    return data as AdminSnapshot;
  }
  async moderateReport(id: string, disabled: boolean) {
    const {data, error} = await this.client.functions.invoke('admin', {body: {action: 'moderate-report', reportId: id, disabled}});
    if (error || data?.error) throw new Error(data?.error || 'The report could not be updated.');
  }

  async bootstrapGtaCatalogue(onProgress?: (progress: CatalogueImportProgress) => void): Promise<CatalogueImportResult> {
    let discovered = 0;
    let imported = 0;
    let updated = 0;

    for (let index = 0; index < GTA_DISCOVERY_AREAS.length; index++) {
      const area = GTA_DISCOVERY_AREAS[index];
      const {data, error} = await this.client.functions.invoke('wash-ingest', {
        body: {lat: area.lat, lng: area.lng, radiusMetres: area.radiusMetres},
      });
      if (error || data?.error) {
        throw new Error(`GTA import stopped at ${area.name}: ${data?.error || error?.message || 'Places discovery failed.'}`);
      }
      discovered += Number(data?.discovered ?? 0);
      imported += Number(data?.imported ?? 0);
      updated += Number(data?.updated ?? 0);
      onProgress?.({
        area: area.name,
        completed: index + 1,
        total: GTA_DISCOVERY_AREAS.length,
        discovered,
        imported,
        updated,
      });
    }

    return {discovered, imported, updated, areasCompleted: GTA_DISCOVERY_AREAS.length};
  }
}
