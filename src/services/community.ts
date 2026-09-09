import {createClient} from '@supabase/supabase-js';
import {appConfig} from '../config/env';

const client = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
  auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true},
});

export type CommunityProfile = {
  displayName: string | null;
  handle: string | null;
  avatarUrl: string | null;
  bio: string | null;
  email: string | null;
};

export type CommunityChallenge = {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  goal: number;
  rewardPoints: number;
  progress: number;
  completedAt: string | null;
};

export type UserVehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  nickname: string | null;
  vin: string | null;
  isPrimary: boolean;
};

export type ContributionActivity = {
  id: string;
  type: 'queue' | 'session' | 'issue' | 'wash-type';
  label: string;
  detail: string;
  verification: string;
  createdAt: string;
  points: number;
};

export type CommunityDashboard = {
  signedIn: boolean;
  profile: CommunityProfile;
  points: number;
  challenges: CommunityChallenge[];
  vehicles: UserVehicle[];
  activity: ContributionActivity[];
};

const emptyProfile: CommunityProfile = {displayName: null, handle: null, avatarUrl: null, bio: null, email: null};

async function permanentUser() {
  const {data: {user}} = await client.auth.getUser();
  return user && !user.is_anonymous ? user : null;
}

export async function getCommunityDashboard(): Promise<CommunityDashboard> {
  const user = await permanentUser();
  const {data: challengeRows} = await client.from('challenges')
    .select('id,slug,title,description,category,goal,reward_points,sort_order')
    .eq('active', true)
    .order('sort_order');

  if (!user) {
    return {
      signedIn: false,
      profile: emptyProfile,
      points: 0,
      challenges: (challengeRows ?? []).map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        category: row.category,
        goal: Number(row.goal),
        rewardPoints: Number(row.reward_points),
        progress: 0,
        completedAt: null,
      })),
      vehicles: [],
      activity: [],
    };
  }

  await client.rpc('refresh_my_challenges');
  const [profileResult, pointsResult, ledgerResult, progressResult, vehiclesResult, queueResult, typeResult] = await Promise.all([
    client.from('profiles').select('display_name,handle,avatar_url,bio').eq('id', user.id).maybeSingle(),
    client.rpc('my_radar_points'),
    client.from('points_ledger').select('amount,source_type,source_key,description,created_at').eq('user_id', user.id).order('created_at', {ascending: false}).limit(200),
    client.from('challenge_progress').select('challenge_id,progress,completed_at').eq('user_id', user.id),
    client.from('user_vehicles').select('id,year,make,model,nickname,vin,is_primary').eq('user_id', user.id).order('is_primary', {ascending: false}).order('created_at'),
    client.from('queue_reports').select('id,report_kind,queue_bucket,proximity,created_at').eq('user_id', user.id).eq('disabled', false).order('created_at', {ascending: false}).limit(20),
    client.from('wash_type_reports').select('id,proximity,created_at').eq('user_id', user.id).eq('disabled', false).order('created_at', {ascending: false}).limit(20),
  ]);

  const profileRow = profileResult.data;
  const ledger = ledgerResult.data ?? [];
  const points = Number(pointsResult.data ?? 0);
  const progressByChallenge = new Map((progressResult.data ?? []).map((row) => [row.challenge_id, row]));
  const pointsBySource = new Map(ledger.map((row) => [`${row.source_type}:${row.source_key}`, Number(row.amount)]));

  const challenges = (challengeRows ?? []).map((row) => {
    const progress = progressByChallenge.get(row.id);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      category: row.category,
      goal: Number(row.goal),
      rewardPoints: Number(row.reward_points),
      progress: Math.min(Number(row.goal), Number(progress?.progress ?? 0)),
      completedAt: progress?.completed_at ?? null,
    };
  });

  const vehicles: UserVehicle[] = (vehiclesResult.data ?? []).map((row) => ({
    id: row.id,
    year: Number(row.year),
    make: row.make,
    model: row.model,
    nickname: row.nickname,
    vin: row.vin,
    isPrimary: Boolean(row.is_primary),
  }));

  const queueActivity: ContributionActivity[] = (queueResult.data ?? []).map((row) => {
    const kind = String(row.report_kind);
    const type: ContributionActivity['type'] = kind === 'session' ? 'session' : kind === 'queue' ? 'queue' : 'issue';
    const label = type === 'session' ? 'Verified wait completed' : type === 'queue' ? 'Queue updated' : 'Operational issue reported';
    const bucket = row.queue_bucket ? String(row.queue_bucket).replace('-', '–') : '';
    const detail = type === 'queue' && bucket ? `${bucket} cars` : type === 'session' ? 'Observed wait saved' : kind.replace('-', ' ');
    return {
      id: row.id,
      type,
      label,
      detail,
      verification: String(row.proximity),
      createdAt: row.created_at,
      points: pointsBySource.get(`queue_report:${row.id}`) ?? 0,
    };
  });

  const typeActivity: ContributionActivity[] = (typeResult.data ?? []).map((row) => ({
    id: row.id,
    type: 'wash-type',
    label: 'Wash type confirmed',
    detail: 'Helped improve wash-type accuracy',
    verification: String(row.proximity),
    createdAt: row.created_at,
    points: pointsBySource.get(`wash_type_report:${row.id}`) ?? 0,
  }));

  return {
    signedIn: true,
    profile: {
      displayName: profileRow?.display_name ?? null,
      handle: profileRow?.handle ?? null,
      avatarUrl: profileRow?.avatar_url ?? null,
      bio: profileRow?.bio ?? null,
      email: user.email ?? null,
    },
    points,
    challenges,
    vehicles,
    activity: [...queueActivity, ...typeActivity].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 12),
  };
}

export async function saveCommunityProfile(input: {displayName: string; handle: string; bio?: string}) {
  const user = await permanentUser();
  if (!user) throw new Error('Sign in to save your profile.');
  const displayName = input.displayName.trim();
  const handle = input.handle.trim().replace(/^@/, '');
  const bio = input.bio?.trim() || null;
  if (displayName.length < 2 || displayName.length > 50) throw new Error('Display name must be 2–50 characters.');
  if (!/^[A-Za-z0-9_]{3,24}$/.test(handle)) throw new Error('Handle must be 3–24 letters, numbers or underscores.');
  const {error} = await client.from('profiles').upsert({id: user.id, display_name: displayName, handle, bio, updated_at: new Date().toISOString()});
  if (error?.code === '23505') throw new Error('That handle is already taken.');
  if (error) throw new Error('Your profile could not be saved.');
}

export async function addVehicle(input: {year: number; make: string; model: string; nickname?: string; vin?: string}) {
  const user = await permanentUser();
  if (!user) throw new Error('Sign in to add a vehicle.');
  const year = Number(input.year);
  const make = input.make.trim();
  const model = input.model.trim();
  const nickname = input.nickname?.trim() || null;
  const vin = input.vin?.trim().toUpperCase() || null;
  if (!Number.isInteger(year) || year < 1980 || year > new Date().getFullYear() + 1) throw new Error('Choose a valid vehicle year.');
  if (!make || !model) throw new Error('Make and model are required.');
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new Error('VIN must contain 17 valid characters.');
  const {count} = await client.from('user_vehicles').select('id', {head: true, count: 'exact'}).eq('user_id', user.id);
  const {error} = await client.from('user_vehicles').insert({user_id: user.id, year, make, model, nickname, vin, is_primary: (count ?? 0) === 0});
  if (error) throw new Error('That vehicle could not be added.');
}

export async function removeVehicle(vehicleId: string) {
  const user = await permanentUser();
  if (!user) throw new Error('Sign in to manage vehicles.');
  const {error} = await client.from('user_vehicles').delete().eq('id', vehicleId).eq('user_id', user.id);
  if (error) throw new Error('That vehicle could not be removed.');
}

export async function setPrimaryVehicle(vehicleId: string) {
  const user = await permanentUser();
  if (!user) throw new Error('Sign in to manage vehicles.');
  const {error} = await client.rpc('set_primary_vehicle', {p_vehicle_id: vehicleId});
  if (error) throw new Error('Primary vehicle could not be changed.');
}
