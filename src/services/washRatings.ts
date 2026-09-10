import {appConfig, hasSupabaseConfiguration} from '../config/env';
import {supabaseClient} from './supabaseClient';

export const WASH_RATING_TAGS = [
  {id: 'clean_facility', label: 'Clean facility'},
  {id: 'good_value', label: 'Good value'},
  {id: 'strong_equipment', label: 'Strong equipment'},
  {id: 'gentle_on_paint', label: 'Gentle on paint'},
  {id: 'quick_wash', label: 'Quick wash'},
  {id: 'long_cycle', label: 'Long wash cycle'},
] as const;

export type WashRatingTag = typeof WASH_RATING_TAGS[number]['id'];

export interface WashRatingInput {
  overall: number;
  quality: number | null;
  value: number | null;
  equipment: number | null;
  tags: WashRatingTag[];
}

export interface MyWashRating extends WashRatingInput {
  verifiedVisit: boolean;
  updatedAt: string;
}

export interface WashRatingSummary {
  rating: number | null;
  ratingCount: number;
  quality: number | null;
  value: number | null;
  equipment: number | null;
  verifiedVisitCount: number;
  tags: {tag: WashRatingTag; count: number}[];
  myRating: MyWashRating | null;
}

const EMPTY_SUMMARY: WashRatingSummary = {
  rating: null,
  ratingCount: 0,
  quality: null,
  value: null,
  equipment: null,
  verifiedVisitCount: 0,
  tags: [],
  myRating: null,
};

const DEMO_STORAGE_KEY = 'wr-demo-wash-ratings-v1';

type DemoRatings = Record<string, MyWashRating>;

function isTag(value: unknown): value is WashRatingTag {
  return typeof value === 'string' && WASH_RATING_TAGS.some((tag) => tag.id === value);
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSummary(value: unknown): WashRatingSummary {
  if (!value || typeof value !== 'object') return {...EMPTY_SUMMARY};
  const row = value as Record<string, unknown>;
  const rawTags = Array.isArray(row.tags) ? row.tags : [];
  const rawMine = row.myRating && typeof row.myRating === 'object' ? row.myRating as Record<string, unknown> : null;
  const myTags = rawMine && Array.isArray(rawMine.tags) ? rawMine.tags.filter(isTag) : [];

  return {
    rating: nullableNumber(row.rating),
    ratingCount: Math.max(0, Number(row.ratingCount ?? 0) || 0),
    quality: nullableNumber(row.quality),
    value: nullableNumber(row.value),
    equipment: nullableNumber(row.equipment),
    verifiedVisitCount: Math.max(0, Number(row.verifiedVisitCount ?? 0) || 0),
    tags: rawTags.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const tag = (item as Record<string, unknown>).tag;
      const count = Number((item as Record<string, unknown>).count ?? 0);
      return isTag(tag) && Number.isFinite(count) && count > 0 ? [{tag, count}] : [];
    }),
    myRating: rawMine ? {
      overall: Number(rawMine.overall ?? 0),
      quality: nullableNumber(rawMine.quality),
      value: nullableNumber(rawMine.value),
      equipment: nullableNumber(rawMine.equipment),
      tags: myTags,
      verifiedVisit: Boolean(rawMine.verifiedVisit),
      updatedAt: typeof rawMine.updatedAt === 'string' ? rawMine.updatedAt : new Date().toISOString(),
    } : null,
  };
}

function loadDemoRatings(): DemoRatings {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    return raw ? JSON.parse(raw) as DemoRatings : {};
  } catch {
    return {};
  }
}

function demoSummary(washId: string): WashRatingSummary {
  const rating = loadDemoRatings()[washId];
  if (!rating) return {...EMPTY_SUMMARY};
  return {
    rating: rating.overall,
    ratingCount: 1,
    quality: rating.quality,
    value: rating.value,
    equipment: rating.equipment,
    verifiedVisitCount: 0,
    tags: rating.tags.map((tag) => ({tag, count: 1})),
    myRating: rating,
  };
}

export async function getWashRatingSummary(washId: string): Promise<WashRatingSummary> {
  if (appConfig.demoMode) return demoSummary(washId);
  if (!hasSupabaseConfiguration) return {...EMPTY_SUMMARY};

  const {data, error} = await supabaseClient.rpc('wash_rating_summary', {p_wash_id: washId});
  if (error) throw new Error('WashRadar ratings are temporarily unavailable.');
  return normalizeSummary(data);
}

export async function submitWashRating(washId: string, input: WashRatingInput): Promise<WashRatingSummary> {
  if (input.overall < 1 || input.overall > 5) throw new Error('Choose an overall rating first.');
  if (input.tags.length > 3) throw new Error('Choose up to three highlights.');

  if (appConfig.demoMode) {
    const ratings = loadDemoRatings();
    ratings[washId] = {...input, verifiedVisit: false, updatedAt: new Date().toISOString()};
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(ratings));
    return demoSummary(washId);
  }
  if (!hasSupabaseConfiguration) throw new Error('WashRadar ratings are unavailable until production data is connected.');

  const {data: {session}} = await supabaseClient.auth.getSession();
  if (!session) {
    const {error: signInError} = await supabaseClient.auth.signInAnonymously();
    if (signInError) throw new Error('Your rating could not be started right now.');
  }

  const {data, error} = await supabaseClient.rpc('submit_wash_rating', {
    p_wash_id: washId,
    p_overall: input.overall,
    p_quality: input.quality,
    p_value: input.value,
    p_equipment: input.equipment,
    p_tags: [...new Set(input.tags)].slice(0, 3),
  });
  if (error) {
    const message = error.message?.trim();
    throw new Error(message && !message.toLowerCase().includes('function') ? message : 'Your rating could not be saved.');
  }
  return normalizeSummary(data);
}
