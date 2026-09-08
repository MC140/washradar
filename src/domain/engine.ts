import {QUEUE_CONFIG, RECOMMENDATION_WEIGHTS} from './config';
import type {CarWash, Point, QueueBucket, QueueEstimate, QueueSignal, RankedWash, WeatherSignal, WashType} from './models';

export function distanceKm(a: Point, b: Point): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(value));
}

export function queueBucketToWait(bucket: QueueBucket, minutesPerCar: number): number {
  return Math.round(QUEUE_CONFIG.queueCars[bucket] * minutesPerCar);
}

export function freshnessWeight(ageMinutes: number): number {
  if (ageMinutes < 0 || ageMinutes > QUEUE_CONFIG.signalExpiryMinutes) return 0;
  if (ageMinutes <= 5) return 1;
  if (ageMinutes <= 15) return 0.75;
  if (ageMinutes <= 30) return 0.4;
  return 0.15;
}

function reputationFactor(score = 50): number {
  return Math.min(1.25, Math.max(0.65, score / 50));
}

function signalWeight(signal: QueueSignal, now: Date): number {
  const age = (now.getTime() - new Date(signal.createdAt).getTime()) / 60_000;
  const proximity = signal.verification === 'session' ? 1.45 : signal.verification === 'nearby' ? 1 : 0.12;
  return freshnessWeight(age) * proximity * reputationFactor(signal.reputation ?? 50);
}

function agreementFactor(wait: number, consensus: number): number {
  const delta = Math.abs(wait - consensus);
  if (delta <= 4) return 1;
  if (delta <= 10) return 0.75;
  if (delta <= 20) return 0.4;
  return 0.15;
}

function weightedMedian(items: {wait: number; weight: number}[]): number {
  if (!items.length) return 0;
  const sorted = [...items].sort((a, b) => a.wait - b.wait);
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  let running = 0;
  for (const item of sorted) {
    running += item.weight;
    if (running >= total / 2) return item.wait;
  }
  return sorted[sorted.length - 1].wait;
}

export function estimateQueue(wash: CarWash, signals: QueueSignal[], now = new Date()): QueueEstimate {
  const uniqueActors = new Map<string, QueueSignal>();
  signals
    .filter((signal) => signal.washId === wash.id && !signal.disabled)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .forEach((signal) => uniqueActors.set(signal.actorHash, signal));

  const active = [...uniqueActors.values()].filter((signal) => signalWeight(signal, now) > 0);
  const closureReports = active.filter((signal) => signal.kind === 'closed' || signal.kind === 'broken');
  const nearbyClosures = closureReports.filter((signal) => signal.verification !== 'remote');
  const normalReports = active.filter((signal) => signal.kind === 'normal' && signal.verification !== 'remote');
  let operatingStatus = wash.status;
  if (nearbyClosures.length >= 2 && nearbyClosures.length > normalReports.length) operatingStatus = 'unavailable';

  const queueSignals = active.filter((signal) => signal.waitMinutes !== null && signal.waitMinutes >= 0);
  const weightedInputs = queueSignals.map((signal) => ({
    signal,
    wait: Math.min(signal.waitMinutes ?? 0, QUEUE_CONFIG.maximumObservedWaitMinutes),
    age: (now.getTime() - new Date(signal.createdAt).getTime()) / 60_000,
    baseWeight: signalWeight(signal, now),
  })).filter((item) => item.baseWeight > 0);

  const consensus = weightedMedian(weightedInputs.map((item) => ({wait: item.wait, weight: item.baseWeight})));
  const historicalWeight = wash.historicalSampleCount > 0
    ? Math.min(1.5, 0.25 + wash.historicalSampleCount / 30)
    : 0;
  let weightedWait = wash.historicalWaitMinutes * historicalWeight;
  let totalWeight = historicalWeight;

  for (const item of weightedInputs) {
    const weight = item.baseWeight * agreementFactor(item.wait, consensus);
    weightedWait += item.wait * weight;
    totalWeight += weight;
  }

  // A numeric 0 remains an internal fallback for compatibility. UI and ranking must
  // call hasQueueEvidence() before presenting it as a real zero-minute wait.
  const waitMinutes = totalWeight > 0 ? Math.max(0, Math.round(weightedWait / totalWeight)) : 0;
  const strongAgreementInputs = weightedInputs.filter((item) => item.signal.verification !== 'remote');
  const agreementInputs = strongAgreementInputs.length ? strongAgreementInputs : weightedInputs;
  const agreementConsensus = weightedMedian(agreementInputs.map((item) => ({wait: item.wait, weight: item.baseWeight})));
  const disagreementWeight = agreementInputs.reduce((sum, item) => sum + item.baseWeight, 0);
  const disagreement = disagreementWeight > 0
    ? agreementInputs.reduce((sum, item) => sum + Math.abs(item.wait - agreementConsensus) * item.baseWeight, 0) / disagreementWeight
    : 0;
  const newest = weightedInputs.reduce<Date | null>((latest, item) => {
    const date = new Date(item.signal.createdAt);
    return !latest || date > latest ? date : latest;
  }, null);
  const newestAge = newest ? (now.getTime() - newest.getTime()) / 60_000 : Number.POSITIVE_INFINITY;
  const freshStrong = weightedInputs.filter((item) => item.age <= QUEUE_CONFIG.liveMaxAgeMinutes && item.signal.verification !== 'remote');
  const freshSessions = freshStrong.filter((item) => item.signal.verification === 'session');
  const freshRemote = weightedInputs.filter((item) => item.age <= QUEUE_CONFIG.liveMaxAgeMinutes && item.signal.verification === 'remote');
  const agreementScore = weightedInputs.length ? Math.max(0, 1 - disagreement / 20) : 0;
  const historyStrength = Math.min(20, wash.historicalSampleCount * 0.8);
  const evidenceStrength = Math.min(52, freshStrong.length * 18 + freshSessions.length * 10 + Math.min(2, freshRemote.length) * 2);
  let confidenceScore = Math.round(Math.min(96, Math.max(8, 12 + historyStrength + evidenceStrength + agreementScore * 12)));
  if (!freshStrong.length && freshRemote.length && wash.historicalSampleCount < 8) confidenceScore = Math.min(confidenceScore, 32);

  const dataState =
    (freshSessions.length >= 1 && confidenceScore >= 65) || (freshStrong.length >= 2 && confidenceScore >= 60)
      ? 'LIVE'
      : newestAge <= QUEUE_CONFIG.recentMaxAgeMinutes
        ? 'RECENT REPORT'
        : 'ESTIMATED';
  const confidenceLabel =
    dataState === 'ESTIMATED' && wash.historicalSampleCount >= 8
      ? 'Historical Estimate'
      : dataState === 'ESTIMATED' && wash.historicalSampleCount < 3
        ? 'Limited Data'
        : confidenceScore >= 75
          ? 'High'
          : confidenceScore >= 45
            ? 'Medium'
            : 'Low';

  return {
    waitMinutes,
    confidenceScore,
    confidenceLabel,
    dataState,
    lastUpdatedAt: newest?.toISOString() ?? null,
    operatingStatus,
    estimatedCars: weightedInputs.length ? Math.round(waitMinutes / Math.max(wash.minutesPerCar, 0.5)) : null,
    recentSignalCount: weightedInputs.length,
  };
}

export function hasQueueEvidence(wash: Pick<CarWash, 'historicalSampleCount'>, estimate: Pick<QueueEstimate, 'recentSignalCount'>): boolean {
  return estimate.recentSignalCount > 0 || wash.historicalSampleCount > 0;
}

export function totalTime(driveMinutes: number, queueMinutes: number, washMinutes: number): number {
  return Math.max(0, driveMinutes) + Math.max(0, queueMinutes) + Math.max(0, washMinutes);
}

export function startingPrice(wash: CarWash): number {
  const prices = wash.packages.map((item) => item.price).filter((price): price is number => price !== null);
  return prices.length ? Math.min(...prices) : Number.POSITIVE_INFINITY;
}

export function rankWash(
  wash: CarWash,
  estimate: QueueEstimate,
  origin: Point,
  options: {preferredTypes?: WashType[]; weather?: WeatherSignal | null; routeMinutes?: number} = {},
): RankedWash {
  const rawDistance = distanceKm(origin, wash.position);
  const driveMinutes = options.routeMinutes ?? Math.max(2, Math.round(rawDistance / 0.58 + 2));
  const queueKnown = hasQueueEvidence(wash, estimate);
  const queueForRanking = queueKnown ? estimate.waitMinutes : 0;
  const tripTotal = totalTime(driveMinutes, queueForRanking, wash.estimatedWashMinutes);
  const price = startingPrice(wash);
  const preferred = options.preferredTypes?.some((type) => wash.types.includes(type)) ?? false;
  const weatherAdjustment =
    options.weather?.suitability === 'good'
      ? RECOMMENDATION_WEIGHTS.goodWeatherBonus
      : options.weather?.suitability === 'poor'
        ? RECOMMENDATION_WEIGHTS.poorWeatherPenalty
        : 0;
  const unavailable = estimate.operatingStatus === 'closed' || estimate.operatingStatus === 'unavailable';
  const trustPenalty =
    (estimate.operatingStatus === 'unknown' ? RECOMMENDATION_WEIGHTS.unknownHoursPenalty : 0) +
    (!queueKnown ? RECOMMENDATION_WEIGHTS.unknownQueuePenalty : 0) +
    (!Number.isFinite(price) ? RECOMMENDATION_WEIGHTS.unknownPricePenalty : 0) +
    (!wash.types.length ? RECOMMENDATION_WEIGHTS.unknownWashTypePenalty : 0);
  const score =
    unavailable
      ? Number.POSITIVE_INFINITY
      : tripTotal * RECOMMENDATION_WEIGHTS.totalMinutes +
        rawDistance * RECOMMENDATION_WEIGHTS.distanceKm +
        (Number.isFinite(price) ? price : 20) * RECOMMENDATION_WEIGHTS.priceCad +
        (wash.rating ?? 3.8) * RECOMMENDATION_WEIGHTS.rating +
        (100 - estimate.confidenceScore) * RECOMMENDATION_WEIGHTS.uncertainty +
        (preferred ? RECOMMENDATION_WEIGHTS.preferredTypeBonus : 0) +
        weatherAdjustment +
        trustPenalty;

  return {
    ...wash,
    estimate,
    distanceKm: Math.round(rawDistance * 10) / 10,
    driveMinutes,
    driveTimeSource: options.routeMinutes ? 'ROUTE' : 'ESTIMATED',
    // totalMinutes is only a complete door-to-done total when hasQueueEvidence() is true.
    totalMinutes: tripTotal,
    score,
    reasons: [],
  };
}

export function rankWashes(
  washes: CarWash[],
  signals: QueueSignal[],
  origin: Point,
  options: {preferredTypes?: WashType[]; weather?: WeatherSignal | null; routeMinutes?: Record<string, number>} = {},
  now = new Date(),
): RankedWash[] {
  const ranked = washes
    .map((wash) => rankWash(wash, estimateQueue(wash, signals, now), origin, {...options, routeMinutes: options.routeMinutes?.[wash.id]}))
    .sort((a, b) => a.score - b.score);

  const eligible = ranked.filter((wash) => wash.estimate.operatingStatus !== 'closed' && wash.estimate.operatingStatus !== 'unavailable');
  const explicitlyOpen = eligible.filter((wash) => wash.estimate.operatingStatus === 'open');
  const pool = explicitlyOpen.length ? explicitlyOpen : eligible;
  const best = pool[0];
  if (!best) return ranked;
  const nearest = [...pool].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  const fastest = pool.filter((wash) => hasQueueEvidence(wash, wash.estimate)).sort((a, b) => a.totalMinutes - b.totalMinutes)[0];
  const cheapest = pool.filter((wash) => Number.isFinite(startingPrice(wash))).sort((a, b) => startingPrice(a) - startingPrice(b))[0];
  const runnerUp = pool[1];

  for (const wash of ranked) {
    const reasons: string[] = [];
    if (wash.id === fastest?.id) reasons.push('Fastest option with queue data');
    if (wash.estimate.waitMinutes === 0 && wash.estimate.recentSignalCount > 0) reasons.push('No reported queue');
    if (wash.rating !== null && wash.rating >= 4.5) reasons.push('Highly rated');
    if (wash.id === cheapest?.id) reasons.push('Lowest known starting price');
    if (wash.id === best.id && !hasQueueEvidence(wash, wash.estimate)) reasons.push('Best available estimate · queue unknown');
    if (wash.id === best.id && wash.estimate.operatingStatus === 'unknown') reasons.push('Hours not yet verified');
    if (wash.id === best.id && hasQueueEvidence(wash, wash.estimate) && nearest && nearest.id !== wash.id && wash.totalMinutes < nearest.totalMinutes) {
      reasons.push(`${nearest.totalMinutes - wash.totalMinutes} min faster than the closest option`);
    } else if (wash.id === best.id && hasQueueEvidence(wash, wash.estimate) && runnerUp && hasQueueEvidence(runnerUp, runnerUp.estimate) && runnerUp.totalMinutes > wash.totalMinutes) {
      reasons.push(`Saves about ${runnerUp.totalMinutes - wash.totalMinutes} min`);
    }
    wash.reasons = reasons.slice(0, 2);
  }
  return ranked;
}
