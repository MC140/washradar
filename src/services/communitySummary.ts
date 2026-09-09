import {supabaseClient as client} from './supabaseClient';

export type CommunitySummary = {
  displayName: string | null;
  handle: string | null;
  avatarUrl: string | null;
  email: string | null;
  points: number;
};

export async function getCommunitySummary(): Promise<CommunitySummary | null> {
  const {data: {session}} = await client.auth.getSession();
  const user = session?.user;
  if (!user || user.is_anonymous) return null;

  const [profileResult, pointsResult] = await Promise.all([
    client.from('profiles').select('display_name,handle,avatar_url').eq('id', user.id).maybeSingle(),
    client.rpc('my_radar_points'),
  ]);

  return {
    displayName: profileResult.data?.display_name ?? null,
    handle: profileResult.data?.handle ?? null,
    avatarUrl: profileResult.data?.avatar_url ?? null,
    email: user.email ?? null,
    points: Number(pointsResult.data ?? 0),
  };
}
