import {QUEUE_CONFIG} from './config';
import {distanceKm} from './engine';
import type {Point, QueueReportInput, QueueSignal} from './models';

export function proximityFor(device: Point | undefined, wash: Point): 'nearby' | 'remote' {
  return device && distanceKm(device, wash) <= QUEUE_CONFIG.nearbyRadiusKm ? 'nearby' : 'remote';
}

export function canSubmitLiveReport(device: Point | undefined, wash: Point): boolean {
  return proximityFor(device, wash) === 'nearby';
}

export function validateReport(
  input: QueueReportInput,
  recentActorSignals: QueueSignal[],
  now = new Date(),
): {ok: true} | {ok: false; reason: string} {
  const last = recentActorSignals
    .filter((signal) => !signal.disabled)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (!last) return {ok: true};
  const age = (now.getTime() - new Date(last.createdAt).getTime()) / 60_000;
  if (age < QUEUE_CONFIG.reportCooldownMinutes) return {ok: false, reason: 'Please wait a few minutes before reporting again.'};
  if (last.washId === input.washId && last.kind === input.kind && age < QUEUE_CONFIG.duplicateWindowMinutes) {
    return {ok: false, reason: 'That report was already received.'};
  }
  return {ok: true};
}
