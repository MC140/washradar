import {createClient} from 'npm:@supabase/supabase-js@2.57.4';

function allowedOrigin(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  const configured = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://mc140.github.io').split(',').map((value) => value.trim()).filter(Boolean);
  if (!origin || configured.includes(origin) || origin.startsWith('http://localhost:')) return origin || '*';
  return '';
}

export function cors(request: Request) {
  const origin = allowedOrigin(request);
  return {
    'Access-Control-Allow-Origin': origin || 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {...cors(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
}

export function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: {persistSession: false, autoRefreshToken: false},
  });
}

export async function authenticatedUser(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const {data, error} = await serviceClient().auth.getUser(token);
  return error ? null : data.user;
}

export async function hashValue(value: string) {
  const salt = Deno.env.get('DEVICE_HASH_SALT') || Deno.env.get('SUPABASE_URL') || 'washradar';
  const data = new TextEncoder().encode(salt + ':' + value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function distanceKm(a: {lat: number; lng: number}, b: {lat: number; lng: number}) {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(value));
}
