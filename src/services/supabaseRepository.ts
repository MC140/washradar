import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {appConfig} from '../config/env';
import type {AdCreative, BusinessHours, CarWash, Point, QueueAlert, QueueReportInput, QueueSession, QueueSignal, WashPackage, WashType} from '../domain/models';
import {clientId, readJson, type AdminSnapshot, type ContributionMetrics, type WashRepository} from './repository';

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

  async loadWashes(origin: Point, radiusKm = 50) {
    const {data, error} = await this.client.rpc('nearby_washes', {p_lat: origin.lat, p_lng: origin.lng, p_radius_km: radiusKm});
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
    if (error) throw new Error(error.message || 'That queue action could not be completed.');
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
}
