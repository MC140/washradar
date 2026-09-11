import type {Point} from '../domain/models';

export type StoredLocationSource = 'gps' | 'manual' | 'map';
export type StoredLocation = {
  label: string;
  point: Point;
  source: StoredLocationSource;
  savedAt: string;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const selectedLocationStorageKey = 'wr-selected-location-v2';
export const legacyManualLocationStorageKey = 'wr-manual-location-v1';

function validPoint(point: unknown): point is Point {
  if (!point || typeof point !== 'object') return false;
  const candidate = point as Partial<Point>;
  return typeof candidate.lat === 'number' && typeof candidate.lng === 'number' &&
    Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng) &&
    Math.abs(candidate.lat) <= 90 && Math.abs(candidate.lng) <= 180;
}

function validSource(source: unknown): source is StoredLocationSource {
  return source === 'gps' || source === 'manual' || source === 'map';
}

export function normalizeStoredLocation(value: unknown, fallbackSource: StoredLocationSource = 'manual'): StoredLocation | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoredLocation>;
  const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
  if (!label || !validPoint(candidate.point)) return null;

  const source = validSource(candidate.source) ? candidate.source : fallbackSource;
  const savedAt = typeof candidate.savedAt === 'string' && Number.isFinite(Date.parse(candidate.savedAt))
    ? candidate.savedAt
    : new Date(0).toISOString();

  return {
    label: label.slice(0, 160),
    point: {lat: candidate.point.lat, lng: candidate.point.lng},
    source,
    savedAt,
  };
}

export function browsingPointForGps(point: Point): Point {
  const precision = 10_000;
  return {
    lat: Math.round(point.lat * precision) / precision,
    lng: Math.round(point.lng * precision) / precision,
  };
}

export function restoredLocationLabel(location: StoredLocation): string {
  return location.source === 'gps' ? 'Last location' : location.label;
}

export function readStoredLocation(storage: StorageLike): StoredLocation | null {
  try {
    const currentRaw = storage.getItem(selectedLocationStorageKey);
    if (currentRaw) {
      const current = normalizeStoredLocation(JSON.parse(currentRaw));
      if (current) return current;
      storage.removeItem(selectedLocationStorageKey);
    }

    const legacyRaw = storage.getItem(legacyManualLocationStorageKey);
    if (!legacyRaw) return null;
    const legacy = normalizeStoredLocation(JSON.parse(legacyRaw), 'manual');
    if (!legacy) {
      storage.removeItem(legacyManualLocationStorageKey);
      return null;
    }

    const migrated: StoredLocation = {...legacy, savedAt: new Date().toISOString()};
    storage.setItem(selectedLocationStorageKey, JSON.stringify(migrated));
    storage.removeItem(legacyManualLocationStorageKey);
    return migrated;
  } catch {
    return null;
  }
}

export function writeStoredLocation(storage: StorageLike, location: StoredLocation) {
  storage.setItem(selectedLocationStorageKey, JSON.stringify(location));
  storage.removeItem(legacyManualLocationStorageKey);
}
