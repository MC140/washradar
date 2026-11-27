import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateQueue, freshnessWeight, hasQueueEstimate, hasQueueEvidence, queueBucketToWait, rankWashes, weatherDemandFactor, totalTime} from '../src/domain/engine.ts';
import {contributorLevel, initials} from '../src/domain/community.ts';
import {DEMO_ORIGIN, DEMO_WASHES} from '../src/data/demo.ts';

const signal = (washId, actorHash, waitMinutes, age, extras = {}) => ({
  id: actorHash + age, washId, actorHash, kind: 'queue', waitMinutes, verification: 'nearby',
  createdAt: new Date(Date.now() - age * 60_000).toISOString(), ...extras,
});

test('queue size conversion uses location throughput', () => {
  assert.equal(queueBucketToWait('none', 4), 0);
  assert.equal(queueBucketToWait('4-7', 4), 22);
  assert.equal(queueBucketToWait('12-plus', 1.5), 23);
});
test('fresh queue data outweighs stale data and naturally decays', () => {
  assert.ok(freshnessWeight(3) > freshnessWeight(12));
  assert.ok(freshnessWeight(12) > freshnessWeight(35));
  assert.equal(freshnessWeight(61), 0);
  const wash = {...DEMO_WASHES[0], historicalWaitMinutes: 15};
  const fresh = estimateQueue(wash, [signal(wash.id, 'fresh', 2, 2)]);
  const stale = estimateQueue(wash, [signal(wash.id, 'stale', 2, 50)]);
  assert.ok(fresh.waitMinutes < stale.waitMinutes);
});
test('confidence rises with consistent verified evidence', () => {
  const wash = {...DEMO_WASHES[0], historicalSampleCount: 2};
  const one = estimateQueue(wash, [signal(wash.id, 'a', 5, 3)]);
  const three = estimateQueue(wash, [signal(wash.id, 'a', 5, 3), signal(wash.id, 'b', 6, 4), signal(wash.id, 'c', 5, 5)]);
  assert.ok(three.confidenceScore > one.confidenceScore);
  assert.notEqual(one.dataState, 'LIVE');
  assert.equal(three.dataState, 'LIVE');
});
test('remote reports are accepted as weak evidence and cannot create LIVE alone', () => {
  const wash = {...DEMO_WASHES[0], historicalWaitMinutes: 0, historicalSampleCount: 0};
  const remote = estimateQueue(wash, [signal(wash.id, 'remote-a', 60, 2, {verification: 'remote', reputation: 100})]);
  assert.notEqual(remote.dataState, 'LIVE');
  assert.ok(remote.confidenceScore <= 32);
});
test('a remote outlier does not overpower agreeing nearby reports', () => {
  const wash = {...DEMO_WASHES[0], historicalWaitMinutes: 0, historicalSampleCount: 0};
  const estimate = estimateQueue(wash, [
    signal(wash.id, 'near-a', 18, 2),
    signal(wash.id, 'near-b', 20, 3),
    signal(wash.id, 'remote-outlier', 80, 1, {verification: 'remote', reputation: 100}),
  ]);
  assert.ok(estimate.waitMinutes < 30);
  assert.equal(estimate.dataState, 'LIVE');
});
test('operational closure needs consensus and is excluded from recommendations', () => {
  const wash = {...DEMO_WASHES[0], status: 'open'};
  const reports = [signal(wash.id, 'a', null, 2, {kind: 'broken'}), signal(wash.id, 'b', null, 3, {kind: 'closed'})];
  assert.equal(estimateQueue(wash, reports).operatingStatus, 'unavailable');
  const ranked = rankWashes([wash, DEMO_WASHES[4]], reports, DEMO_ORIGIN);
  assert.notEqual(ranked[0].id, wash.id);
  assert.equal(ranked.find((item) => item.id === wash.id).score, Infinity);
});
test('total time keeps drive, queue and wash distinct', () => {
  assert.equal(totalTime(7, 6, 5), 18);
});
test('a farther wash with no queue can beat the closest congested wash', () => {
  const close = {...DEMO_WASHES[0], position: {...DEMO_ORIGIN}, historicalWaitMinutes: 25, historicalSampleCount: 20};
  const farther = {...DEMO_WASHES[4], position: {lat: DEMO_ORIGIN.lat + 0.025, lng: DEMO_ORIGIN.lng}, historicalWaitMinutes: 0, historicalSampleCount: 20};
  const ranked = rankWashes([close, farther], [], DEMO_ORIGIN);
  assert.equal(ranked[0].id, farther.id);
});
test('low-confidence options receive an uncertainty penalty', () => {
  const confident = {...DEMO_WASHES[0], historicalWaitMinutes: 0, historicalSampleCount: 30};
  const uncertain = {...confident, id: DEMO_WASHES[1].id, historicalSampleCount: 0};
  const ranked = rankWashes([uncertain, confident], [], DEMO_ORIGIN);
  assert.equal(ranked[0].id, confident.id);
});
test('missing queue evidence is not treated as a real zero-minute queue', () => {
  const wash = {...DEMO_WASHES[0], historicalWaitMinutes: 0, historicalSampleCount: 0};
  const estimate = estimateQueue(wash, []);
  assert.equal(estimate.waitMinutes, 0);
  assert.equal(hasQueueEvidence(wash, estimate), false);
  const reported = estimateQueue(wash, [signal(wash.id, 'a', 0, 2)]);
  assert.equal(hasQueueEvidence(wash, reported), true);
});
test('unknown business hours remain rankable but carry a trust penalty', () => {
  const known = {...DEMO_WASHES[0], id: 'known', position: {...DEMO_ORIGIN}, status: 'open', historicalSampleCount: 10};
  const unknown = {...known, id: 'unknown', status: 'unknown'};
  const ranked = rankWashes([unknown, known], [], DEMO_ORIGIN);
  assert.equal(ranked[0].id, 'known');
  assert.ok(Number.isFinite(ranked.find((item) => item.id === 'unknown').score));
});
test('closed and unavailable washes stay ineligible for recommendation', () => {
  const closed = {...DEMO_WASHES[0], status: 'closed'};
  const unavailable = {...DEMO_WASHES[1], status: 'unavailable'};
  const ranked = rankWashes([closed, unavailable], [], DEMO_ORIGIN);
  assert.equal(ranked.every((item) => item.score === Infinity), true);
});
test('Radar Points map deterministically to contributor levels', () => {
  assert.equal(contributorLevel(0).name, 'New Scout');
  assert.equal(contributorLevel(249).level, 1);
  assert.equal(contributorLevel(250).name, 'Queue Scout');
  assert.equal(contributorLevel(750).name, 'Radar Regular');
  assert.equal(contributorLevel(3000).name, 'WashRadar Hero');
  assert.equal(contributorLevel(3000).pointsToNext, 0);
});
test('profile initials prefer display name and safely fall back to email', () => {
  assert.equal(initials('Manohar Chekka', 'x@example.com'), 'MC');
  assert.equal(initials(null, 'radar@example.com'), 'RA');
});

test('production cold-start prediction is stable, labeled and not report evidence', () => {
  const wash = {...DEMO_WASHES[0], dataEnvironment: 'production', status: 'open', historicalSampleCount: 0, historicalWaitMinutes: 0};
  const now = new Date('2026-11-28T17:00:00Z');
  const result = estimateQueue(wash, [], now);
  assert.ok(result.prediction);
  assert.equal(result.dataState, 'ESTIMATED');
  assert.equal(result.lastUpdatedAt, null);
  assert.equal(result.recentSignalCount, 0);
  assert.equal(result.confidenceScore, 8);
  assert.equal(hasQueueEvidence(wash, result), false);
  assert.equal(hasQueueEstimate(wash, result), true);
  assert.deepEqual(estimateQueue(wash, [], new Date('2026-11-28T17:15:00Z')), result);
  const morning = estimateQueue(wash, [], new Date('2026-11-28T12:00:00Z'));
  assert.ok(morning.waitMinutes < result.waitMinutes);
  const report = {...signal(wash.id, 'driver', 0, 0), createdAt: now.toISOString()};
  const actual = estimateQueue(wash, [report], now);
  assert.equal(actual.prediction, undefined);
  assert.equal(actual.waitMinutes, 0);
  assert.equal(hasQueueEvidence(wash, actual), true);
  assert.ok(estimateQueue(wash, [report], new Date('2026-11-28T18:01:00Z')).prediction);
  assert.equal(estimateQueue({...wash, status: 'closed'}, [], now).prediction, undefined);
  assert.equal(estimateQueue({...wash, status: 'unavailable'}, [], now).prediction, undefined);
  assert.equal(estimateQueue({...wash, status: 'unknown'}, [], new Date('2026-11-28T07:00:00Z')).prediction, undefined);
  assert.equal(estimateQueue({...wash, historicalSampleCount: 1}, [], now).prediction, undefined);
});

test('weather factors reduce active precipitation demand, increase post-precipitation demand, and ignore stale weather', () => {
  const now = new Date('2026-11-28T17:00:00Z');
  const wash = {...DEMO_WASHES[0], dataEnvironment: 'production', status: 'open', historicalSampleCount: 0, historicalWaitMinutes: 0};
  const weather = {lat: 43.7, lng: -79.4, observedAt: now.toISOString(), temperatureC: 2, precipitation1hMm: 0, precipitation24hMm: 5};
  const wet = {...wash, predictionWeather: {...weather, precipitation1hMm: 4}};
  const recovery = {...wash, predictionWeather: weather};
  assert.equal(weatherDemandFactor(wet, now), 0.45);
  assert.equal(weatherDemandFactor(recovery, now), 1.5);
  assert.ok(estimateQueue(wet, [], now).waitMinutes < estimateQueue(wash, [], now).waitMinutes);
  assert.ok(estimateQueue(recovery, [], now).waitMinutes > estimateQueue(wash, [], now).waitMinutes);
  assert.equal(estimateQueue(recovery, [], now).prediction.weatherAdjusted, true);
  assert.equal(weatherDemandFactor(recovery, new Date('2026-11-28T21:00:00Z')), 1);
  assert.equal(weatherDemandFactor({...wash, predictionWeather: {...weather, precipitation1hMm: null}}, now), 1);
  const report = {...signal(wash.id, 'driver', 0, 0), createdAt: now.toISOString()};
  assert.equal(estimateQueue(recovery, [report], now).prediction, undefined);
  assert.equal(estimateQueue(recovery, [report], now).waitMinutes, 0);
  const historical = estimateQueue({...recovery, historicalSampleCount: 3, historicalWaitMinutes: 15}, [], now);
  assert.equal(historical.prediction, undefined);
  assert.equal(historical.waitMinutes, 15);
});

test('ECCC observations are deduplicated and stale or malformed data is rejected', async () => {
  const {normalizeObservations} = await import('../functions/api/prediction-weather.js');
  const now = Date.parse('2026-11-28T17:00:00Z');
  const feature = (properties) => ({geometry: {coordinates: [-79.4,43.7]}, properties: {'msc_id-value':'station-a','date_tm-value':'2026-11-28T16:30:00Z',air_temp:2,pcpn_amt_pst1hr:0,pcpn_amt_pst24hrs:5,...properties}});
  const rows = normalizeObservations({features:[feature({}),feature({'date_tm-value':'2026-11-28T16:45:00Z',air_temp:3}),feature({'msc_id-value':'stale','date_tm-value':'2026-11-28T13:00:00Z'}),feature({'msc_id-value':'invalid',air_temp:null})]},now);
  assert.equal(rows.length,1);
  assert.equal(rows[0].temperatureC,3);
  assert.equal(rows[0].precipitation24hMm,5);
  assert.deepEqual(normalizeObservations({},now),[]);
});
