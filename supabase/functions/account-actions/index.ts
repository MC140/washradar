import {z} from 'npm:zod@4.1.8';
import {authenticatedUser, cors, json, serviceClient} from '../_shared/http.ts';

const schema = z.object({action: z.literal('delete-account')});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
  if (request.method !== 'POST') return json(request, {error: 'Method not allowed.'}, 405);

  const user = await authenticatedUser(request);
  if (!user) return json(request, {error: 'A valid WashRadar session is required.'}, 401);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(request, {error: 'Invalid account action.'}, 400);

  const db = serviceClient();

  // Business-owner records intentionally use RESTRICT semantics. Do not silently remove
  // a business/account relationship as part of consumer self-service deletion.
  if (!user.is_anonymous) {
    const {count, error: ownerCheckError} = await db
      .from('advertiser_businesses')
      .select('id', {head: true, count: 'exact'})
      .eq('owner_user_id', user.id);
    if (ownerCheckError) return json(request, {error: 'Account deletion could not be prepared.'}, 500);
    if ((count ?? 0) > 0) {
      return json(request, {
        error: 'This account owns a WashRadar business record. Contact support so the business can be transferred or closed before account deletion.',
        code: 'business-owner-review-required',
      }, 409);
    }
  }

  // Public contribution tables use ON DELETE SET NULL for user_id where history must be
  // retained for queue integrity. Account-owned profile/preferences/points data cascades.
  // Supabase Auth deletion also removes sessions/refresh tokens; already-issued JWTs can
  // remain valid only until their normal expiry, so sensitive operations must keep their
  // existing server-side authorization checks.
  const {error} = await db.auth.admin.deleteUser(user.id, false);
  if (error) {
    console.error(JSON.stringify({event: 'account_delete_failed', userId: user.id, message: error.message}));
    return json(request, {error: 'Your account could not be deleted right now. Please try again or contact support.'}, 500);
  }

  return json(request, {ok: true, deleted: user.is_anonymous ? 'guest' : 'account'});
});
