import {distanceKm} from '../domain/engine';
import type {CarWash, PredictionWeather} from '../domain/models';
import {appConfig} from '../config/env';

const TTL = 30 * 60_000;
let observations: PredictionWeather[] = [];
let nextFetch = 0;
let pending: Promise<void> | undefined;

export function loadPredictionWeather(): Promise<void> {
  if (appConfig.demoMode || Date.now() < nextFetch) return Promise.resolve();
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch('/api/prediction-weather', {signal: AbortSignal.timeout(6500)});
      if (!response.ok) throw new Error('Weather unavailable');
      const data = await response.json();
      if (!Array.isArray(data?.observations)) throw new Error('Weather unavailable');
      observations = data.observations.filter((row: PredictionWeather) =>
        row && Number.isFinite(row.lat) && Number.isFinite(row.lng) &&
        Number.isFinite(row.temperatureC) && typeof row.observedAt === 'string');
      nextFetch = Date.now() + (observations.length ? TTL : 5 * 60_000);
    } catch {
      observations = [];
      nextFetch = Date.now() + 5 * 60_000;
    }
  })().finally(() => {pending = undefined;});
  return pending;
}

export function withPredictionWeather<T extends CarWash>(wash: T): T {
  if (wash.dataEnvironment !== 'production') return wash;
  const nearest = observations
    .filter((row) => Date.now() - Date.parse(row.observedAt) <= 2 * 60 * 60_000)
    .map((row) => ({row, distance: distanceKm(wash.position, row)}))
    .sort((a, b) => a.distance - b.distance)[0];
  return {...wash, predictionWeather: nearest && nearest.distance <= 35 ? nearest.row : undefined};
}
