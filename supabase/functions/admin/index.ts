import {z} from 'npm:zod@4.1.8';
import {authenticatedUser, cors, json, serviceClient} from '../_shared/http.ts';

const schema = z.discriminatedUnion('action', [
  z.object({action: z.literal('snapshot')}),
  z.object({action: z.literal('moderate-report'), reportId: z.string().uuid(), disabled: z.boolean()}),
]);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
  const user = await authenticatedUser(request);
  const allowed = (Deno.env.get('ADMIN_EMAILS') ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!user?.email || !allowed.includes(user.email.toLowerCase())) return json(request, {error: 'Administrator access is required.'}, 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(request, {error: 'Invalid admin action.'}, 400);
  const db = serviceClient();
  if (parsed.data.action === 'moderate-report') {
    const {error} = await db.from('queue_reports').update({disabled: parsed.data.disabled}).eq('id', parsed.data.reportId);
    if (error) return json(request, {error: 'Report update failed.'}, 500);
    await db.from('moderation_flags').insert({entity_type: 'queue_report', entity_id: parsed.data.reportId, reason: parsed.data.disabled ? 'Disabled by administrator' : 'Restored by administrator', status: 'actioned', created_by: user.id, reviewed_by: user.id, reviewed_at: new Date().toISOString()});
    return json(request, {ok: true});
  }
  const [washes, sessions, campaigns, reports] = await Promise.all([
    db.from('car_washes').select('id', {head: true, count: 'exact'}).eq('data_environment', 'production').eq('active', true),
    db.from('queue_sessions').select('id', {head: true, count: 'exact'}).eq('status', 'active'),
    db.from('ad_campaigns').select('id', {head: true, count: 'exact'}).eq('status', 'active'),
    db.from('queue_reports').select('id,wash_id,report_kind,created_at,disabled,proximity').order('created_at', {ascending: false}).limit(50),
  ]);
  return json(request, {
    washCount: washes.count ?? 0,
    activeSessionCount: sessions.count ?? 0,
    activeCampaignCount: campaigns.count ?? 0,
    reports: (reports.data ?? []).map((report) => ({
      id: report.id, washId: report.wash_id, kind: report.report_kind, createdAt: report.created_at,
      disabled: report.disabled, verification: report.proximity,
    })),
  });
});
