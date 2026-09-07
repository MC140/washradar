import type {
  AdCreative,
  CarWash,
  Point,
  QueueAlert,
  QueueReportInput,
  QueueSession,
  QueueSignal,
} from '../domain/models';

export interface ContributionMetrics {
  reportsSubmitted: number;
  completedWaits: number;
  reputation: number;
  streakDays: number;
}

export interface AdminSnapshot {
  washCount: number;
  activeSessionCount: number;
  activeCampaignCount: number;
  reports: {id: string; washId: string; kind: string; createdAt: string; disabled: boolean; verification: string}[];
}

export interface WashRepository {
  readonly mode: 'demo' | 'supabase' | 'unavailable';
  loadWashes(origin: Point, radiusKm?: number): Promise<{washes: CarWash[]; signals: QueueSignal[]}>;
  routeTimes(origin: Point, washes: CarWash[]): Promise<Record<string, number>>;
  searchLocation(query: string): Promise<Point | null>;
  subscribe(onChange: () => void): () => void;
  submitReport(input: QueueReportInput): Promise<{verification: 'nearby' | 'remote'}>;
  startQueueSession(washId: string, position?: Point, initialQueueBucket?: QueueSession['initialQueueBucket']): Promise<QueueSession>;
  finishQueueSession(action: 'completed' | 'cancelled'): Promise<QueueSession | null>;
  getActiveQueueSession(): Promise<QueueSession | null>;
  getFavouriteIds(): Promise<string[]>;
  toggleFavourite(washId: string, saved: boolean): Promise<void>;
  getAlerts(): Promise<QueueAlert[]>;
  createAlert(washId: string, thresholdMinutes: number): Promise<QueueAlert>;
  submitPriceCorrection(washId: string, amount: number | null, note: string): Promise<void>;
  removeAlert(id: string): Promise<void>;
  getAd(placement: string, origin: Point, washId?: string): Promise<AdCreative | null>;
  recordAdEvent(ad: AdCreative, event: 'impression' | 'click', placement: string): Promise<void>;
  signInWithEmail(email: string): Promise<void>;
  signOut(): Promise<void>;
  authState(): Promise<{signedIn: boolean; email: string | null}>;
  metrics(): Promise<ContributionMetrics>;
  adminSnapshot(): Promise<AdminSnapshot>;
  moderateReport(id: string, disabled: boolean): Promise<void>;
}

export class UnavailableRepository implements WashRepository {
  readonly mode = 'unavailable' as const;
  private failure(): never {
    throw new Error('WashRadar is not connected to its production data service yet.');
  }
  loadWashes(): Promise<{washes: CarWash[]; signals: QueueSignal[]}> { return Promise.reject(new Error('Nearby wash data is temporarily unavailable. Search or retry in a moment.')); }
  routeTimes(): Promise<Record<string, number>> { return Promise.resolve({}); }
  searchLocation(): Promise<Point | null> { return Promise.resolve(null); }
  subscribe(): () => void { return () => undefined; }
  submitReport(): Promise<{verification: 'nearby' | 'remote'}> { return Promise.reject(this.failure()); }
  startQueueSession(): Promise<QueueSession> { return Promise.reject(this.failure()); }
  finishQueueSession(): Promise<QueueSession | null> { return Promise.reject(this.failure()); }
  getActiveQueueSession(): Promise<QueueSession | null> { return Promise.resolve(null); }
  getFavouriteIds(): Promise<string[]> { return Promise.resolve(readJson('wr-favourites', [])); }
  toggleFavourite(washId: string, saved: boolean): Promise<void> {
    const current = new Set<string>(readJson('wr-favourites', []));
    if (saved) current.add(washId);
    else current.delete(washId);
    localStorage.setItem('wr-favourites', JSON.stringify([...current]));
    return Promise.resolve();
  }
  getAlerts(): Promise<QueueAlert[]> { return Promise.resolve(readJson('wr-alerts', [])); }
  createAlert(): Promise<QueueAlert> { return Promise.reject(this.failure()); }
  submitPriceCorrection(): Promise<void> { return Promise.reject(this.failure()); }
  removeAlert(): Promise<void> { return Promise.reject(this.failure()); }
  getAd(): Promise<AdCreative | null> { return Promise.resolve(null); }
  recordAdEvent(): Promise<void> { return Promise.resolve(); }
  signInWithEmail(): Promise<void> { return Promise.reject(this.failure()); }
  signOut(): Promise<void> { return Promise.resolve(); }
  authState(): Promise<{signedIn: boolean; email: string | null}> { return Promise.resolve({signedIn: false, email: null}); }
  metrics(): Promise<ContributionMetrics> { return Promise.resolve({reportsSubmitted: 0, completedWaits: 0, reputation: 50, streakDays: 0}); }
  adminSnapshot(): Promise<AdminSnapshot> { return Promise.reject(this.failure()); }
  moderateReport(): Promise<void> { return Promise.reject(this.failure()); }
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

export function clientId(): string {
  let id = localStorage.getItem('wr-client-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('wr-client-id', id);
  }
  return id;
}
