import {DEMO_ADS, DEMO_WASHES, createDemoSignals} from '../data/demo';
import {proximityFor, validateReport} from '../domain/abuse';
import {queueBucketToWait} from '../domain/engine';
import type {Point, QueueAlert, QueueReportInput, QueueSession, QueueSignal} from '../domain/models';
import {clientId, readJson, type AdminSnapshot, type CatalogueImportResult, type ContributionMetrics, type WashRepository} from './repository';
import {geocodeDemoSearch} from './location';
import {rankWashes} from '../domain/engine';

type DemoState = {
  signals: QueueSignal[];
  session: QueueSession | null;
  favourites: string[];
  alerts: QueueAlert[];
  metrics: ContributionMetrics;
  adCursor: number;
};

const STORAGE_KEY = 'washradar-demo-v2';
const listeners = new Set<() => void>();

function loadState(): DemoState {
  return readJson<DemoState>(STORAGE_KEY, {
    signals: [],
    session: null,
    favourites: [],
    alerts: [],
    metrics: {reportsSubmitted: 0, completedWaits: 0, reputation: 50, streakDays: 0},
    adCursor: 0,
  });
}

function saveState(state: DemoState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  listeners.forEach((listener) => listener());
}

export class DemoRepository implements WashRepository {
  readonly mode = 'demo' as const;

  async loadWashes() {
    const stored = loadState().signals;
    return {washes: DEMO_WASHES, signals: [...createDemoSignals(), ...stored]};
  }
  async routeTimes() { return {}; }

  async searchLocation(query: string) {
    return geocodeDemoSearch(query, rankWashes(DEMO_WASHES, createDemoSignals(), {lat: 43.589, lng: -79.644}));
  }

  subscribe(onChange: () => void) {
    listeners.add(onChange);
    const timer = window.setInterval(onChange, 30_000);
    return () => {
      listeners.delete(onChange);
      window.clearInterval(timer);
    };
  }

  async submitReport(input: QueueReportInput) {
    const state = loadState();
    const wash = DEMO_WASHES.find((item) => item.id === input.washId);
    if (!wash) throw new Error('That wash could not be found.');
    const actorHash = clientId();
    const recent = state.signals.filter((signal) => signal.actorHash === actorHash);
    const validation = validateReport(input, recent);
    if (!validation.ok) throw new Error(validation.reason);
    const verification = proximityFor(input.position, wash.position);
    const waitMinutes = input.queueBucket ? queueBucketToWait(input.queueBucket, wash.minutesPerCar) : null;
    state.signals.push({
      id: crypto.randomUUID(),
      washId: wash.id,
      actorHash,
      kind: input.kind,
      waitMinutes,
      queueBucket: input.queueBucket,
      verification,
      createdAt: new Date().toISOString(),
      reputation: state.metrics.reputation,
    });
    state.metrics.reportsSubmitted += 1;
    state.metrics.reputation = Math.min(80, state.metrics.reputation + (verification === 'nearby' ? 2 : 0));
    saveState(state);
    return {verification};
  }

  async startQueueSession(washId: string, position?: Point, initialQueueBucket?: QueueSession['initialQueueBucket']) {
    const state = loadState();
    if (state.session?.status === 'active') throw new Error('You already have an active queue timer.');
    const wash = DEMO_WASHES.find((item) => item.id === washId);
    if (!wash) throw new Error('That wash could not be found.');
    const session: QueueSession = {
      id: crypto.randomUUID(),
      washId,
      startedAt: new Date().toISOString(),
      status: 'active',
      verification: proximityFor(position, wash.position),
      initialQueueBucket,
    };
    state.session = session;
    saveState(state);
    return session;
  }

  async finishQueueSession(action: 'completed' | 'cancelled') {
    const state = loadState();
    if (!state.session || state.session.status !== 'active') return null;
    const elapsed = Math.max(1, Math.min(90, Math.round((Date.now() - new Date(state.session.startedAt).getTime()) / 60_000)));
    state.session = {...state.session, status: action, observedWaitMinutes: action === 'completed' ? elapsed : undefined};
    if (action === 'completed') {
      state.signals.push({
        id: state.session.id,
        washId: state.session.washId,
        actorHash: clientId(),
        kind: 'session',
        waitMinutes: elapsed,
        verification: state.session.verification === 'nearby' ? 'session' : 'remote',
        createdAt: new Date().toISOString(),
        reputation: state.metrics.reputation,
      });
      state.metrics.completedWaits += 1;
      state.metrics.reputation = Math.min(100, state.metrics.reputation + (state.session.verification === 'nearby' ? 5 : 1));
    }
    saveState(state);
    return state.session;
  }

  async getActiveQueueSession() {
    const session = loadState().session;
    return session?.status === 'active' ? session : null;
  }

  async getFavouriteIds() { return loadState().favourites; }

  async toggleFavourite(washId: string, saved: boolean) {
    const state = loadState();
    const favourites = new Set(state.favourites);
    if (saved) favourites.add(washId);
    else favourites.delete(washId);
    state.favourites = [...favourites];
    saveState(state);
  }

  async getAlerts() { return loadState().alerts; }

  async createAlert(washId: string, thresholdMinutes: number) {
    const state = loadState();
    const alert: QueueAlert = {id: crypto.randomUUID(), washId, thresholdMinutes, enabled: true, triggeredAt: null};
    state.alerts.push(alert);
    saveState(state);
    return alert;
  }
  async submitPriceCorrection() { return; }

  async removeAlert(id: string) {
    const state = loadState();
    state.alerts = state.alerts.filter((alert) => alert.id !== id);
    saveState(state);
  }

  async getAd() {
    const state = loadState();
    const ad = DEMO_ADS[state.adCursor % DEMO_ADS.length];
    state.adCursor += 1;
    saveState(state);
    return ad;
  }

  async recordAdEvent() {
    return;
  }

  async signInWithEmail() {
    throw new Error('Demo mode keeps data on this device. Connect Supabase to use email sign-in.');
  }
  async signOut() { return; }
  async authState() { return {signedIn: false, email: null}; }
  async metrics() { return loadState().metrics; }
  async adminSnapshot(): Promise<AdminSnapshot> {
    const state = loadState();
    return {
      washCount: DEMO_WASHES.length,
      activeSessionCount: state.session?.status === 'active' ? 1 : 0,
      activeCampaignCount: DEMO_ADS.length,
      reports: [...state.signals, ...createDemoSignals()].slice(-25).reverse().map((signal) => ({
        id: signal.id,
        washId: signal.washId,
        kind: signal.kind,
        createdAt: signal.createdAt,
        disabled: Boolean(signal.disabled),
        verification: signal.verification,
      })),
    };
  }
  async moderateReport(id: string, disabled: boolean) {
    const state = loadState();
    state.signals = state.signals.map((signal) => signal.id === id ? {...signal, disabled} : signal);
    saveState(state);
  }
  async bootstrapGtaCatalogue(): Promise<CatalogueImportResult> {
    throw new Error('GTA catalogue bootstrap is available only in production mode.');
  }
}
