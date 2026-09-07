import test from 'node:test';
import assert from 'node:assert/strict';
import {canSubmitLiveReport, proximityFor, validateReport} from '../src/domain/abuse.ts';
import {DEMO_ORIGIN} from '../src/data/demo.ts';

test('geofence distinguishes nearby and remote reports', () => {
  assert.equal(proximityFor({lat: DEMO_ORIGIN.lat + 0.001, lng: DEMO_ORIGIN.lng}, DEMO_ORIGIN), 'nearby');
  assert.equal(proximityFor({lat: DEMO_ORIGIN.lat + 0.02, lng: DEMO_ORIGIN.lng}, DEMO_ORIGIN), 'remote');
  assert.equal(canSubmitLiveReport(undefined, DEMO_ORIGIN), false);
});
test('duplicate and rapid reports are rejected', () => {
  const now = new Date();
  const recent = [{id: 'one', washId: 'wash', actorHash: 'actor', kind: 'queue', queueBucket: '1-3', waitMinutes: 8, verification: 'nearby', createdAt: new Date(now.getTime() - 60_000).toISOString()}];
  assert.equal(validateReport({washId: 'wash', kind: 'queue', queueBucket: '1-3'}, recent, now).ok, false);
});
test('a contributor can report after cooldown', () => {
  const now = new Date();
  const recent = [{id: 'one', washId: 'wash', actorHash: 'actor', kind: 'queue', queueBucket: '1-3', waitMinutes: 8, verification: 'nearby', createdAt: new Date(now.getTime() - 12 * 60_000).toISOString()}];
  assert.equal(validateReport({washId: 'wash', kind: 'queue', queueBucket: '4-7'}, recent, now).ok, true);
});
