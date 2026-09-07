import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {toast} from 'sonner';
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
import {DEMO_ORIGIN} from '../data/demo';
import {analytics, logger} from '../services/analytics';
import {repository} from '../services';
import {requestLocation} from '../services/location';
import type {ContributionMetrics} from '../services/repository';

type State = {
  mode: typeof repository.mode;
  origin: Point;
  currentPosition?: Point;
  locationLabel: string;
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

const Context = createContext<State | null>(null);
const initialMetrics = {reportsSubmitted: 0, completedWaits: 0, reputation: 50, streakDays: 0};

function storedFilters(): WashFilters {
  try {
    const stored = localStorage.getItem('wr-filters-v2');
    return stored ? {...DEFAULT_FILTERS, ...JSON.parse(stored)} : {...DEFAULT_FILTERS};
  } catch {
    return {...DEFAULT_FILTERS};
  }
}

export function WashRadarProvider({children}: {children: ReactNode}) {
  const [origin, setOrigin] = useState<Point>(DEMO_ORIGIN);
  const [currentPosition, setCurrentPosition] = useState<Point>();
  const [locationLabel, setLocationLabel] = useState('Mississauga, ON');
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
  const [sort, setSort] = useState<SortMode>('Recommended');
  const [auth, setAuth] = useState({signedIn: false, email: null as string | null});
  const refreshVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try {
      const [{washes: rawWashes, signals}, favouriteIds, savedAlerts, activeSession, authState, contributionMetrics] = await Promise.all([
        repository.loadWashes(origin, Math.max(filters.maximumDistanceKm, 25)),
        repository.getFavouriteIds(),
        repository.getAlerts(),
        repository.getActiveQueueSession(),
        repository.authState(),
        repository.metrics(),
      ]);
      if (version !== refreshVersion.current) return;
      setWashes(rankWashes(rawWashes, signals, origin, {preferredTypes: filters.types}));
      setSignals(signals);
      setFavourites(favouriteIds);
      setAlerts(savedAlerts);
      setSession(activeSession);
      setAuth(authState);
      setMetrics(contributionMetrics);
      setError('');
      void repository.routeTimes(origin, rawWashes).then((routeMinutes) => {
        if (version === refreshVersion.current && Object.keys(routeMinutes).length) {
          setWashes(rankWashes(rawWashes, signals, origin, {preferredTypes: filters.types, routeMinutes}));
        }
      });
    } catch (caught) {
      logger.error(caught, {area: 'refresh'});
      setError(caught instanceof Error ? caught.message : 'Wash data is temporarily unavailable.');
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }, [filters.maximumDistanceKm, filters.types, origin]);

  useEffect(() => {
    analytics.track('app_opened', {mode: repository.mode});
    void refresh();
    return repository.subscribe(() => void refresh());
  }, [refresh]);

  useEffect(() => {
    localStorage.setItem('wr-filters-v2', JSON.stringify(filters));
  }, [filters]);

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
      setCurrentPosition(result.point);
      setOrigin(result.point);
      setLocationLabel('Current location');
      analytics.track('location_granted', {accuracyBand: result.accuracy <= 100 ? 'good' : 'coarse'});
      toast.success('Nearby washes updated.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Location is unavailable.';
      toast.info(message);
    }
  }, []);

  const search = useCallback(async (query: string) => {
    const point = await repository.searchLocation(query);
    analytics.track('search', {hasResult: Boolean(point)});
    if (!point) return false;
    setOrigin(point);
    setLocationLabel(query.trim());
    return true;
  }, []);

  const setFilters = useCallback((next: WashFilters) => setFiltersState(next), []);

  const toggleFavourite = useCallback(async (washId: string) => {
    const save = !favourites.includes(washId);
    await repository.toggleFavourite(washId, save);
    setFavourites((current) => save ? [...new Set([...current, washId])] : current.filter((id) => id !== washId));
    analytics.track('favourite', {washId, saved: save});
  }, [favourites]);

  const submitReport = useCallback(async (input: Omit<QueueReportInput, 'position'>) => {
    const result = await repository.submitReport({...input, position: currentPosition});
    analytics.track('queue_report_completed', {washId: input.washId, verification: result.verification});
    await refresh();
    return result.verification;
  }, [currentPosition, refresh]);

  const startSession = useCallback(async (washId: string, bucket?: QueueBucket) => {
    const started = await repository.startQueueSession(washId, currentPosition, bucket);
    setSession(started);
    analytics.track('queue_session_started', {washId, verification: started.verification});
  }, [currentPosition]);

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
  }), [origin, currentPosition, locationLabel, washes, signals, loading, error, offline, favourites, alerts, session, metrics, filters, sort, auth, refresh, locate, search, setFilters, toggleFavourite, submitReport, startSession, finishSession, createAlert, removeAlert, signIn, signOut]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWashRadar() {
  const value = useContext(Context);
  if (!value) throw new Error('useWashRadar must be used within WashRadarProvider');
  return value;
}
