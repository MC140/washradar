export type Point = {lat: number; lng: number};

export type WashType =
  | 'touchless'
  | 'soft-cloth'
  | 'automatic'
  | 'self-serve'
  | 'hand-wash'
  | 'tunnel';

export interface WashTypeTruth {
  washType: WashType;
  confidenceScore: number;
  sourceLabel: string;
}

export type OperatingStatus = 'open' | 'closed' | 'unavailable' | 'unknown';
export type QueueDataState = 'LIVE' | 'RECENT REPORT' | 'ESTIMATED';
export type ConfidenceLabel = 'High' | 'Medium' | 'Low' | 'Limited Data' | 'Historical Estimate';
export type VerificationLevel = 'nearby' | 'remote' | 'session';

export interface WashPackage {
  id: string;
  name: string;
  washType: WashType;
  price: number | null;
  currency: string;
  membershipAvailable?: boolean;
  promotion?: string | null;
  verifiedAt?: string | null;
  sourceLabel?: string | null;
}

export interface BusinessHours {
  weekday: number;
  opensAt: string | null;
  closesAt: string | null;
  closed: boolean;
}

export interface CarWash {
  id: string;
  name: string;
  address: string;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  position: Point;
  types: WashType[];
  typeTruth?: WashTypeTruth[];
  packages: WashPackage[];
  status: OperatingStatus;
  rating: number | null;
  ratingCount: number;
  estimatedWashMinutes: number;
  minutesPerCar: number;
  historicalWaitMinutes: number;
  historicalSampleCount: number;
  hours: BusinessHours[];
  amenities: string[];
  dataEnvironment: 'production' | 'demo';
  sourceUpdatedAt: string | null;
}

export interface QueueSignal {
  id: string;
  washId: string;
  actorHash: string;
  kind: 'queue' | 'session' | 'normal' | 'closed' | 'broken' | 'stalled' | 'payment' | 'dryer' | 'other';
  waitMinutes: number | null;
  queueBucket?: QueueBucket | null;
  verification: VerificationLevel;
  createdAt: string;
  reputation?: number;
  disabled?: boolean;
}

export type QueueBucket = 'none' | '1-3' | '4-7' | '8-12' | '12-plus';

export interface QueueEstimate {
  waitMinutes: number;
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel;
  dataState: QueueDataState;
  lastUpdatedAt: string | null;
  operatingStatus: OperatingStatus;
  estimatedCars: number | null;
  recentSignalCount: number;
}

export interface WeatherSignal {
  suitability: 'good' | 'neutral' | 'poor';
  precipitationNext24hMm: number | null;
  message: string | null;
  fetchedAt: string;
}

export interface RankedWash extends CarWash {
  estimate: QueueEstimate;
  distanceKm: number;
  driveMinutes: number;
  driveTimeSource: 'ROUTE' | 'ESTIMATED';
  totalMinutes: number;
  score: number;
  reasons: string[];
}

export interface QueueReportInput {
  washId: string;
  kind: QueueSignal['kind'];
  queueBucket?: QueueBucket;
  position?: Point;
}

export interface QueueSession {
  id: string;
  washId: string;
  startedAt: string;
  status: 'active' | 'completed' | 'cancelled';
  verification: VerificationLevel;
  initialQueueBucket?: QueueBucket;
  observedWaitMinutes?: number;
}

export interface QueueAlert {
  id: string;
  washId: string;
  thresholdMinutes: number;
  enabled: boolean;
  triggeredAt: string | null;
}

export interface AdCreative {
  id: string;
  campaignId: string;
  businessName: string;
  headline: string;
  body: string;
  callToAction: string;
  destinationUrl: string;
  disclosure: 'Sponsored' | 'Nearby offer';
  distanceKm?: number;
}

export type SortMode = 'Recommended' | 'Fastest Total Time' | 'Shortest Queue' | 'Nearest' | 'Lowest Price';

export interface WashFilters {
  types: WashType[];
  maximumPrice: number;
  maximumDistanceKm: number;
  queueUnderMinutes: number | null;
  openNow: boolean;
}
