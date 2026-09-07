import type {WashFilters, WashType} from './models';

export const WASH_TYPE_CONFIG: Record<WashType, {label: string; defaultDuration: number; minutesPerCar: number}> = {
  touchless: {label: 'Touchless', defaultDuration: 6, minutesPerCar: 4.5},
  'soft-cloth': {label: 'Soft cloth', defaultDuration: 5, minutesPerCar: 3.5},
  automatic: {label: 'Automatic', defaultDuration: 6, minutesPerCar: 4},
  'self-serve': {label: 'Self serve', defaultDuration: 12, minutesPerCar: 3},
  'hand-wash': {label: 'Hand wash', defaultDuration: 25, minutesPerCar: 18},
  tunnel: {label: 'Tunnel / express', defaultDuration: 4, minutesPerCar: 1.5},
};

export const QUEUE_CONFIG = {
  liveMaxAgeMinutes: 10,
  recentMaxAgeMinutes: 45,
  signalExpiryMinutes: 60,
  reportCooldownMinutes: 3,
  duplicateWindowMinutes: 10,
  maximumObservedWaitMinutes: 90,
  nearbyRadiusKm: 0.35,
  departureRadiusKm: 0.65,
  maximumAccurateGpsMetres: 120,
  queueCars: {none: 0, '1-3': 2, '4-7': 5.5, '8-12': 10, '12-plus': 15},
} as const;

export const RECOMMENDATION_WEIGHTS = {
  totalMinutes: 1,
  distanceKm: 0.35,
  priceCad: 0.14,
  rating: -1.15,
  uncertainty: 0.045,
  preferredTypeBonus: -2.75,
  goodWeatherBonus: -0.35,
  poorWeatherPenalty: 0.5,
} as const;

export const DEFAULT_FILTERS: WashFilters = {
  types: [],
  maximumPrice: 50,
  maximumDistanceKm: 25,
  queueUnderMinutes: null,
  openNow: true,
};
