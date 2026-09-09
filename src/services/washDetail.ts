import {appConfig} from '../config/env';
import {DEMO_WASHES, createDemoSignals} from '../data/demo';
import {rankWashes} from '../domain/engine';
import type {BusinessHours, CarWash, Point, QueueSignal, RankedWash, WashPackage, WashType} from '../domain/models';
import {supabaseClient} from './supabaseClient';

type DirectoryRow = {
  id: string;
  name: string;
  address_line: string;
  city: string;
  region_name: string;
  country_name: string;
  postal_code: string;
  latitude: number;
  longitude: number;
  operating_status: CarWash['status'];
  rating: number | null;
  rating_count: number;
  estimated_wash_minutes: number;
  minutes_per_car: number;
  historical_wait_minutes: number;
  historical_sample_count: number;
  source_updated_at: string | null;
  wash_types: WashType[];
  packages: WashPackage[];
  hours: BusinessHours[];
  amenities: string[];
};

function mapWash(row: DirectoryRow): CarWash {
  return {
    id: row.id,
    name: row.name,
    address: row.address_line,
    city: row.city,
    region: row.region_name,
    country: row.country_name,
    postalCode: row.postal_code,
    position: {lat: Number(row.latitude), lng: Number(row.longitude)},
    types: row.wash_types ?? [],
    packages: row.packages ?? [],
    status: row.operating_status,
    rating: row.rating === null ? null : Number(row.rating),
    ratingCount: row.rating_count ?? 0,
    estimatedWashMinutes: row.estimated_wash_minutes,
    minutesPerCar: Number(row.minutes_per_car),
    historicalWaitMinutes: row.historical_wait_minutes,
    historicalSampleCount: row.historical_sample_count,
    hours: row.hours ?? [],
    amenities: row.amenities ?? [],
    dataEnvironment: 'production',
    sourceUpdatedAt: row.source_updated_at,
  };
}

export async function loadWashDetail(washId: string, origin?: Point): Promise<{wash: RankedWash | null; signals: QueueSignal[]}> {
  if (appConfig.demoMode) {
    const raw = DEMO_WASHES.find((item) => item.id === washId);
    if (!raw) return {wash: null, signals: []};
    const signals = createDemoSignals();
    return {wash: rankWashes([raw], signals, origin ?? raw.position)[0] ?? null, signals};
  }

  const {data, error} = await supabaseClient.rpc('wash_detail_json', {p_wash_id: washId});
  if (error) throw new Error('This wash could not be loaded right now.');
  if (!data) return {wash: null, signals: []};

  const raw = mapWash(data as DirectoryRow);
  const response = await supabaseClient.rpc('queue_signal_feed', {p_wash_ids: [washId]});
  const signals = response.error ? [] : (response.data ?? []) as QueueSignal[];
  return {wash: rankWashes([raw], signals, origin ?? raw.position)[0] ?? null, signals};
}
