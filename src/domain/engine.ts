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
  if (ageMinutes <= 5) return 1 - ageMinutes * 0.025;
  if (ageMinutes <= 15) return 0.875 * Math.exp(-(ageMinutes - 5) / 15);
  if (ageMinutes <= 30) return 0.45 * Math.exp(-(ageMinutes - 15) / 20);
  return 0.21 * Math.exp(-(ageMinutes - 30) / 18);
}

function signalWeight(signal: QueueSignal, now: Date): number {
  const age = (now.getTime() - new Date(signal.createdAt).getTime()) / 60_000;
  const proximity = signal.verification === 'session' ? 1.55 : signal.verification === 'nearby' ? 1.2 : 0.35;
  const reputation = Math.min(1.3, Math.max(0.55, (signal.reputation ?? 50) / 50));
  return freshnessWeight(age) * proximity * reputation;
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
  const normalReports = active.filter((signal) => signal.kind === 'normal');
  let operatingStatus = wash.status;
  if (nearbyClosures.length >= 2 && nearbyClosures.length > normalReports.length) operatingStatus = 'unavailable';

  const queueSignals = active.filter((signal) => signal.waitMinutes !== null && signal.waitMinutes >= 0);
  const historicalWeight = Math.min(2.2, 0.55 + wash.historicalSampleCount / 25);
  let weightedWait = wash.historicalWaitMinutes * historicalWeight;
  let totalWeight = historicalWeight;
  let liveEvidence = 0;

  for (const signal of queueSignals) {
    const weight = signalWeight(signal, now);
    weightedWait += Math.min(signal.waitMinutes ?? 0, QUEUE_CONFIG.maximumObservedWaitMinutes) * weight;
    totalWeight += weight;
    liveEvidence += weight;
  }

  const waitMinutes = Math.max(0, Math.round(weightedWait / Math.max(totalWeight, 0.01)));
  const disagreement = queueSignals.length
    ? queueSignals.reduce((total, signal) => total + Math.abs((signal.waitMinutes ?? 0) - waitMinutes), 0) / queueSignals.length
    : 0;
  const newest = queueSignals.reduce<Date | null>((latest, signal) => {
    const date = new Date(signal.createdAt);
    return !latest || date > latest ? date : latest;
  }, null);
  const newestAge = newest ? (now.getTime() - newest.getTime()) / 60_000 : Number.POSITIVE_INFINITY;
  const historyStrength = Math.min(22, wash.historicalSampleCount * 1.1);
  const confidenceScore = Math.round(Math.min(96, Math.max(8, 14 + historyStrength + liveEvidence * 18 - Math.min(30, disagreement * 1.5))));
  const dataState =
    newestAge <= QUEUE_CONFIG.liveMaxAgeMinutes && confidenceScore >= 50
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
    estimatedCars: queueSignals.length ? Math.round(waitMinutes / Math.max(wash.minutesPerCar, 0.5)) : null,
    recentSignalCount: queueSignals.length,
  };
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
  const tripTotal = totalTime(driveMinutes, estimate.waitMinutes, wash.estimatedWashMinutes);
  const price = startingPrice(wash);
  const preferred = options.preferredTypes?.some((type) => wash.types.includes(type)) ?? false;
  const weatherAdjustment =
    options.weather?.suitability === 'good'
      ? RECOMMENDATION_WEIGHTS.goodWeatherBonus
      : options.weather?.suitability === 'poor'
        ? RECOMMENDATION_WEIGHTS.poorWeatherPenalty
        : 0;
  const score =
    estimate.operatingStatus === 'open'
      ? tripTotal * RECOMMENDATION_WEIGHTS.totalMinutes +
        rawDistance * RECOMMENDATION_WEIGHTS.distanceKm +
        (Number.isFinite(price) ? price : 20) * RECOMMENDATION_WEIGHTS.priceCad +
        (wash.rating ?? 3.8) * RECOMMENDATION_WEIGHTS.rating +
        (100 - estimate.confidenceScore) * RECOMMENDATION_WEIGHTS.uncertainty +
        (preferred ? RECOMMENDATION_WEIGHTS.preferredTypeBonus : 0) +
        weatherAdjustment
      : Number.POSITIVE_INFINITY;

  return {
    ...wash,
    estimate,
    distanceKm: Math.round(rawDistance * 10) / 10,
    driveMinutes,
    driveTimeSource: options.routeMinutes ? 'ROUTE' : 'ESTIMATED',
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

  const open = ranked.filter((wash) => wash.estimate.operatingStatus === 'open');
  const best = open[0];
  if (!best) return ranked;
  const nearest = [...open].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  const fastest = [...open].sort((a, b) => a.totalMinutes - b.totalMinutes)[0];
  const cheapest = [...open].sort((a, b) => startingPrice(a) - startingPrice(b))[0];
  const runnerUp = open[1];

  for (const wash of ranked) {
    const reasons: string[] = [];
    if (wash.id === fastest?.id) reasons.push('Fastest option nearby');
    if (wash.estimate.waitMinutes === 0) reasons.push('No reported queue');
    if (wash.rating !== null && wash.rating >= 4.5) reasons.push('Highly rated');
    if (wash.id === cheapest?.id) reasons.push('Lowest starting price');
    if (wash.id === best.id && nearest && nearest.id !== wash.id && wash.totalMinutes < nearest.totalMinutes) {
      reasons.push('${nearest.totalMinutes - wash.totalMinutes} min faster than the closest option');
    } else if (wash.id === best.id && runnerUp && runnerUp.totalMinutes > wash.totalMinutes) {
      reasons.push('Saves about ${runnerUp.totalMinutes - wash.totalMinutes} min');
    }
    wash.reasons = reasons.slice(0, 2);
  }
  return ranked;
}
