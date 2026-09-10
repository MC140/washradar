import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {toast} from 'sonner';
import {appConfig} from '../config/env';
import {DEFAULT_FILTERS, QUEUE_CONFIG} from '../domain/config';
import {distanceKm, rankWashes} from '../domain/engine';
import type {
  Point,
  QueueAlert,
  QueueBucket,
  QueueReportInput,
  QueueSession,
  QueueSignal,
  RankedWash,
  SortMode,
  WashFilters,
} from '../domain/models';
import {analytics, logger} from '../services/analytics';
import {repository} from '../services';
import {requestLocation} from '../services/location';
import type {ContributionMetrics} from '../services/repository';
import {loadQueueSignals} from '../services/scaleRefresh';

type State = {
  mode: typeof repository.mode;
  origin: Point;
  currentPosition?: Point;
  locationLabel: string;
  locationReady: boolean;
  washes: RankedWash[];
  signals: QueueSignal[];
  loading: boolean;
  error: string;
  offline: boolean;
  favourites: string[];
  alerts: QueueAlert[];
  session: QueueSession | null;
  metrics: ContributionMetrics;
  filters: WashFilters;
  sort: SortMode;
  auth: {signedIn: boolean; email: string | null};
  refresh: () => Promise<void>;
  locate: () => Promise<void>;
  search: (query: string) => Promise<boolean>;
  exploreAt: (point: Point) => void;
  setFilters: (filters: WashFilters) => void;
  setSort: (sort: SortMode) => void;
  toggleFavourite: (washId: string) => Promise<void>;
  submitReport: (input: Omit<QueueReportInput, 'position'>) => Promise<'nearby' | 'remote'>;
  startSession: (washId: string, bucket?: QueueBucket) => Promise<void>;
  finishSession: (action: 'completed' | 'cancelled') => Promise<void>;
  createAlert: (washId: string, threshold: number) => Promise<void>;
  removeAlert: (id: string) => Promise<void>;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

type StoredManualLocation = {label: string; point: Point};

const Context = createContext<State | null>(null);
const initialMetrics = {reportsSubmitted: 0, completedWaits: 0, reputation: 50, streakDays: 0};
const neutralOrigin: Point = {lat: 43.6532, lng: -79.3832};
const manualLocationStorageKey = 'wr-manual-location-v1';
const sortStorageKey = 'wr-sort-v1';
const supportedSortModes: SortMode[] = ['Recommended', 'Fastest Total Time', 'Shortest Queue', 'Nearest', 'Lowest Price'];

function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function storedFilters(): WashFilters {
  try {
    const stored = localStorage.getItem('wr-filters-v2');
    return stored ? {...DEFAULT_FILTERS, ...JSON.parse(stored)} : {...DEFAULT_FILTERS};
  } catch {
    return {...DEFAULT_FILTERS};
  }
}

function storedManualLocation(): StoredManualLocation | null {
  try {
    if (!hasStorage()) return null;
    const stored = localStorage.getItem(manualLocationStorageKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<StoredManualLocation>;
    const label = typeof parsed.label === 'string' ? parsed.label.trim() : '';
    const lat = parsed.point?.lat;
    const lng = parsed.point?.lng;
    if (
      !label || typeof lat !== 'number' || typeof lng !== 'number' ||
      !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180
    ) {
      localStorage.removeItem(manualLocationStorageKey);
      return null;
    }
    return {label: label.slice(0, 160), point: {lat, lng}};
  } catch {
    return null;
  }
}

function storedSort(): SortMode {
  try {
    if (!hasStorage()) return 'Recommended';
    const stored = localStorage.getItem(sortStorageKey) as SortMode | null;
    return stored && supportedSortModes.includes(stored) ? stored : 'Recommended';
  } catch {
    return 'Recommended';
  }
}

export function WashRadarProvider({children}: {children: ReactNode}) {
  const [restoredManualLocation] = useState(storedManualLocation);
  const [origin, setOrigin] = useState<Point>(() => restoredManualLocation?.point ?? neutralOrigin);
  const [currentPosition, setCurrentPosition] = useState<Point>();
  const [locationLabel, setLocationLabel] = useState(() => restoredManualLocation?.label ?? 'Set location');
  const [locationReady, setLocationReady] = useState(() => Boolean(restoredManualLocation));
  const [washes, setWashes] = useState<RankedWash[]>([]);
  const [signals, setSignals] = useState<QueueSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<QueueAlert[]>([]);
  const [session, setSession] = useState<QueueSession | null>(null);
  const [metrics, setMetrics] = useState<ContributionMetrics>(initialMetrics);
  const [filters, setFiltersState] = useState<WashFilters>(storedFilters);
  const [sort, setSortState] = useState<SortMode>(storedSort);
  const [auth, setAuth] = useState({signedIn: false, email: null as string | null});
  const refreshVersion = useRef(0);
  const activeWashIdsKey = useMemo(() => washes.map((wash) => wash.id).sort().join(','), [washes]);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try {
      if (!locationReady) {
        const [favouriteIds, savedAlerts, activeSession, authState, contributionMetrics] = await Promise.all([
          repository.getFavouriteIds(),
          repository.getAlerts(),
          repository.getActiveQueueSession(),
          repository.authState(),
          repository.metrics(),
        ]);
        if (version !== refreshVersion.current) return;
        setWashes([]);
        setSignals([]);
        setFavourites(favouriteIds);
        setAlerts(savedAlerts);
        setSession(activeSession);
        setAuth(authState);
        setMetrics(contributionMetrics);
        setError('');
        return;
      }

      const [{washes: rawWashes, signals: freshSignals}, favouriteIds, savedAlerts, activeSession, authState, contributionMetrics] = await Promise.all([
        repository.loadWashes(origin, Math.max(filters.maximumDistanceKm, 25)),
        repository.getFavouriteIds(),
        repository.getAlerts(),
        repository.getActiveQueueSession(),
        repository.authState(),
        repository.metrics(),
      ]);
      if (version !== refreshVersion.current) return;

      setWashes(rankWashes(rawWashes, freshSignals, origin, {preferredTypes: filters.types}));
      setSignals(freshSignals);
      setFavourites(favouriteIds);
      setAlerts(savedAlerts);
      setSession(activeSession);
      setAuth(authState);
      setMetrics(contributionMetrics);
      setError('');
    } catch (caught) {
      logger.error(caught, {area: 'refresh'});
      setError(caught instanceof Error ? caught.message : 'Wash data is temporarily unavailable.');
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }, [filters.maximumDistanceKm, filters.types, locationReady, origin]);

  const refreshQueueSignals = useCallback(async () => {
    if (!locationReady || repository.mode !== 'supabase' || !activeWashIdsKey) return;
    try {
      const freshSignals = await loadQueueSignals(activeWashIdsKey.split(','));
      setSignals(freshSignals);
      setWashes((current) => current.length
        ? rankWashes(current, freshSignals, origin, {preferredTypes: filters.types})
        : current);
    } catch (caught) {
      logger.error(caught, {area: 'queue-refresh'});
    }
  }, [activeWashIdsKey, filters.types, locationReady, origin]);

  useEffect(() => {
    analytics.track('app_opened', {mode: repository.mode});
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!locationReady) return;
    if (repository.mode !== 'supabase') return repository.subscribe(() => void refresh());
    if (appConfig.queueRefreshMode === 'realtime') return repository.subscribe(() => void refreshQueueSignals());

    const intervalMs = appConfig.queuePollMs + Math.floor(Math.random() * 4_000);
    const poll = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refreshQueueSignals();
    };
    const timer = window.setInterval(poll, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refreshQueueSignals();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [locationReady, refresh, refreshQueueSignals]);

  useEffect(() => {
    localStorage.setItem('wr-filters-v2', JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    if (hasStorage()) localStorage.setItem(sortStorageKey, sort);
  }, [sort]);

  useEffect(() => {
    const online = () => { setOffline(false); void refresh(); };
    const offlineHandler = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', offlineHandler);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offlineHandler);
    };
  }, [refresh]);

  useEffect(() => {
    if (!locationReady) return;
    const timer = window.setInterval(() => {
      setWashes((current) => current.length
        ? rankWashes(current, signals, origin, {preferredTypes: filters.types}, new Date())
        : current);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [filters.types, locationReady, origin, signals]);

  useEffect(() => {
    if (!session || session.verification === 'remote' || !navigator.geolocation) return;
    const wash = washes.find((item) => item.id === session.washId);
    if (!wash) return;
    const watcher = navigator.geolocation.watchPosition(
      (position) => {
        const point = {lat: position.coords.latitude, lng: position.coords.longitude};
        if (
          position.coords.accuracy <= QUEUE_CONFIG.maximumAccurateGpsMetres &&
          distanceKm(point, wash.position) > QUEUE_CONFIG.departureRadiusKm
        ) {
          navigator.geolocation.clearWatch(watcher);
          void repository.finishQueueSession('completed').then(() => {
            setSession(null);
            analytics.track('queue_session_completed', {washId: wash.id});
            void refresh();
          });
          toast.success('Your observed wait was saved after you left the wash area.');
        }
      },
      () => undefined,
      {enableHighAccuracy: false, maximumAge: 15_000, timeout: 20_000},
    );
    return () => navigator.geolocation.clearWatch(watcher);
  }, [session, washes, refresh]);

  const locate = useCallback(async () => {
    try {
      const result = await requestLocation();
      if (hasStorage()) localStorage.removeItem(manualLocationStorageKey);
      setCurrentPosition(result.point);
      setOrigin(result.point);
      setLocationLabel('Current location');
      setLocationReady(true);
      setLoading(true);
      analytics.track('location_granted', {accuracyBand: result.accuracy <= 100 ? 'good' : 'coarse'});
      toast.success('Nearby washes updated.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Location is unavailable.';
      if (!locationReady) setLocationLabel('Set location');
      toast.info(message);
    }
  }, [locationReady]);

  const search = useCallback(async (query: string) => {
    const point = await repository.searchLocation(query);
    analytics.track('search', {hasResult: Boolean(point)});
    if (!point) return false;
    const label = query.trim();
    if (hasStorage()) {
      const storedLocation: StoredManualLocation = {label, point};
      localStorage.setItem(manualLocationStorageKey, JSON.stringify(storedLocation));
    }
    setCurrentPosition(undefined);
    setOrigin(point);
    setLocationLabel(label);
    setLocationReady(true);
    setLoading(true);
    return true;
  }, []);

  const exploreAt = useCallback((point: Point) => {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return;
    const label = 'Pinned map area';
    if (hasStorage()) {
      const storedLocation: StoredManualLocation = {label, point};
      localStorage.setItem(manualLocationStorageKey, JSON.stringify(storedLocation));
    }
    setCurrentPosition(undefined);
    setOrigin(point);
    setLocationLabel(label);
    setLocationReady(true);
    setLoading(true);
    analytics.track('search', {hasResult: true, source: 'map-pan'});
    toast.success('Showing washes around this map area.');
  }, []);

  const setFilters = useCallback((next: WashFilters) => setFiltersState(next), []);
  const setSort = useCallback((next: SortMode) => setSortState(next), []);

  const toggleFavourite = useCallback(async (washId: string) => {
    const save = !favourites.includes(washId);
    await repository.toggleFavourite(washId, save);
    setFavourites((current) => save ? [...new Set([...current, washId])] : current.filter((id) => id !== washId));
    analytics.track('favourite', {washId, saved: save});
  }, [favourites]);

  const submitReport = useCallback(async (input: Omit<QueueReportInput, 'position'>) => {
    let verifiedPosition: Point | undefined;
    try {
      const freshLocation = await requestLocation();
      setCurrentPosition(freshLocation.point);
      if (freshLocation.accuracy <= QUEUE_CONFIG.maximumAccurateGpsMetres) verifiedPosition = freshLocation.point;
    } catch {
      verifiedPosition = undefined;
    }
    const result = await repository.submitReport({...input, position: verifiedPosition});
    analytics.track('queue_report_completed', {washId: input.washId, verification: result.verification});
    await refresh();
    return result.verification;
  }, [refresh]);

  const startSession = useCallback(async (washId: string, bucket?: QueueBucket) => {
    const wash = washes.find((item) => item.id === washId);
    if (!wash) throw new Error('This wash is not available right now.');
    const freshLocation = await requestLocation();
    setCurrentPosition(freshLocation.point);
    if (freshLocation.accuracy > QUEUE_CONFIG.maximumAccurateGpsMetres) {
      throw new Error('GPS accuracy is too low to verify a queue timer. Try again in a moment or move closer to the wash entrance.');
    }
    if (distanceKm(freshLocation.point, wash.position) > QUEUE_CONFIG.nearbyRadiusKm) {
      throw new Error('You need to be at this car wash to start a verified queue timer. Quick queue reports still work from anywhere.');
    }
    const started = await repository.startQueueSession(washId, freshLocation.point, bucket);
    setSession(started);
    analytics.track('queue_session_started', {washId, verification: started.verification});
  }, [washes]);

  const finishSession = useCallback(async (action: 'completed' | 'cancelled') => {
    const finished = await repository.finishQueueSession(action);
    setSession(null);
    if (action === 'completed' && finished) analytics.track('queue_session_completed', {washId: finished.washId});
    await refresh();
  }, [refresh]);

  const createAlert = useCallback(async (washId: string, threshold: number) => {
    const alert = await repository.createAlert(washId, threshold);
    setAlerts((current) => [...current, alert]);
    analytics.track('alert_created', {washId, threshold});
  }, []);

  const removeAlert = useCallback(async (id: string) => {
    await repository.removeAlert(id);
    setAlerts((current) => current.filter((alert) => alert.id !== id));
  }, []);

  const signIn = useCallback(async (email: string) => {
    await repository.signInWithEmail(email);
  }, []);
  const signOut = useCallback(async () => {
    await repository.signOut();
    setAuth({signedIn: false, email: null});
    await refresh();
  }, [refresh]);

  const value = useMemo<State>(() => ({
    mode: repository.mode,
    origin,
    currentPosition,
    locationLabel,
    locationReady,
    washes,
    signals,
    loading,
    error,
    offline,
    favourites,
    alerts,
    session,
    metrics,
    filters,
    sort,
    auth,
    refresh,
    locate,
    search,
    exploreAt,
    setFilters,
    setSort,
    toggleFavourite,
    submitReport,
    startSession,
    finishSession,
    createAlert,
    removeAlert,
    signIn,
    signOut,
  }), [origin, currentPosition, locationLabel, locationReady, washes, signals, loading, error, offline, favourites, alerts, session, metrics, filters, sort, auth, refresh, locate, search, exploreAt, setFilters, setSort, toggleFavourite, submitReport, startSession, finishSession, createAlert, removeAlert, signIn, signOut]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWashRadar() {
  const value = useContext(Context);
  if (!value) throw new Error('useWashRadar must be used within WashRadarProvider');
  return value;
}
