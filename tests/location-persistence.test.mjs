import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browsingPointForGps,
  legacyManualLocationStorageKey,
  normalizeStoredLocation,
  readStoredLocation,
  restoredLocationLabel,
  selectedLocationStorageKey,
  writeStoredLocation,
} from '../src/state/locationPersistence.ts';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values.entries()); },
  };
}

test('normalizes persisted location and rejects invalid coordinates', () => {
  const normalized = normalizeStoredLocation({
    label: ' Markham ',
    point: {lat: 43.8561, lng: -79.337},
    source: 'manual',
    savedAt: '2026-09-10T20:00:00.000Z',
  });
  assert.equal(normalized?.label, 'Markham');
  assert.equal(normalized?.source, 'manual');
  assert.equal(normalizeStoredLocation({label: 'bad', point: {lat: 120, lng: -79}}), null);
});

test('migrates the legacy manual-location record to the durable location key', () => {
  const storage = memoryStorage({
    [legacyManualLocationStorageKey]: JSON.stringify({label: 'M1X 1S7', point: {lat: 43.82, lng: -79.21}}),
  });
  const restored = readStoredLocation(storage);
  assert.equal(restored?.label, 'M1X 1S7');
  assert.equal(restored?.source, 'manual');
  const values = storage.snapshot();
  assert.ok(values[selectedLocationStorageKey]);
  assert.equal(values[legacyManualLocationStorageKey], undefined);
});

test('stores GPS browsing origin at reduced precision and labels it as last location after restore', () => {
  const rounded = browsingPointForGps({lat: 43.85612345, lng: -79.33701234});
  assert.deepEqual(rounded, {lat: 43.8561, lng: -79.337});
  const location = {
    label: 'Current location',
    point: rounded,
    source: 'gps',
    savedAt: '2026-09-10T20:00:00.000Z',
  };
  assert.equal(restoredLocationLabel(location), 'Last location');
});

test('writeStoredLocation replaces the legacy key', () => {
  const storage = memoryStorage({[legacyManualLocationStorageKey]: '{}'});
  const location = {
    label: 'Pinned map area',
    point: {lat: 43.7, lng: -79.4},
    source: 'map',
    savedAt: '2026-09-10T20:00:00.000Z',
  };
  writeStoredLocation(storage, location);
  const values = storage.snapshot();
  assert.equal(values[legacyManualLocationStorageKey], undefined);
  assert.deepEqual(JSON.parse(values[selectedLocationStorageKey]), location);
});
