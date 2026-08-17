'use server';

import { cookies } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const SESSION_TTL_MIN = 60 * 24; // 24 hours
const MIN_STEP_WAIT_MS = 4000;
const COOKIE_NAME = 'gateway_session';

type Step = 'subscribe' | 'like';

export type GatewayResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

export async function getOrCreateSession(downloadId: string): Promise<GatewayResult<any>> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const admin = getSupabaseAdmin();

  // Confirm the resource exists & is accessible.
  const { data: download } = await admin
    .from('downloads')
    .select('id, slug, name, mediafire_url, youtube_channel_url, youtube_video_url, require_subscribe, require_like, active, deleted_at')
    .eq('id', downloadId)
    .is('deleted_at', null)
    .eq('active', true)
    .single();

  if (!download) return { ok: false, error: 'Resource not found.' };

  if (token) {
    // Look for a live session for THIS resource.
    const { data: existing } = await admin
      .from('download_sessions')
      .select('*')
      .eq('session_token', token)
      .eq('download_id', downloadId)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (existing) {
      return { ok: true, data: { ...existing, downloads: download } };
    }

    // If a session row exists for the same token but is expired (or no longer
    // matches this resource), treat it as gone. The next block will mint a
    // fresh session and overwrite the cookie.
  }

  const newToken = uuidv4();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MIN * 60 * 1000).toISOString();

  const { data: created, error } = await admin
    .from('download_sessions')
    .insert({
      session_token: newToken,
      download_id: downloadId,
      expires_at: expiresAt,
      // Defaults are applied at table level; explicitly setting nulls keeps
      // older schemas compatible.
      subscribe_completed: false,
      like_completed: false,
      unlocked: false,
    })
    .select('*')
    .single();

  if (error || !created) return { ok: false, error: 'Could not start session.' };

  cookieStore.set(COOKIE_NAME, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MIN * 60,
  });

  return { ok: true, data: { ...created, downloads: download } };
}

async function loadSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const admin = getSupabaseAdmin();
  const { data: session } = await admin
    .from('download_sessions')
    .select('*')
    .eq('session_token', token)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  return session;
}

export async function startStep(step: Step): Promise<GatewayResult> {
  const session = await loadSession();
  if (!session) return { ok: false, error: 'Session expired. Please refresh and try again.' };

  // Enforce ordering server-side: cannot start "like" before "subscribe" completed.
  if (step === 'like' && !session.subscribe_completed) {
    return { ok: false, error: 'Complete the previous step first.' };
  }

  // Idempotent start: only stamp if not already started.
  const field = `${step}_started_at`;
  if (session[field]) return { ok: true };

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('download_sessions')
    .update({ [field]: new Date().toISOString() })
    .eq('id', session.id)
    .is(field, null);
  if (error) return { ok: false, error: 'Could not start step.' };
  return { ok: true };
}

export async function completeStep(step: Step): Promise<GatewayResult<{ unlocked: boolean }>> {
  const session = await loadSession();
  if (!session) return { ok: false, error: 'Session expired.' };

  if (step === 'like' && !session.subscribe_completed) {
    return { ok: false, error: 'Complete the previous step first.' };
  }

  const startedAt = session[`${step}_started_at`];
  if (!startedAt) {
    return { ok: false, error: 'Please start the step before completing it.' };
  }
  const elapsed = Date.now() - new Date(startedAt).getTime();
  if (elapsed < MIN_STEP_WAIT_MS) {
    return { ok: false, error: 'Please wait a moment before continuing.' };
  }

  const admin = getSupabaseAdmin();
  // Atomically mark this step complete ONLY if it isn't already.
  const { data: updated, error } = await admin
    .from('download_sessions')
    .update({
      [`${step}_completed`]: true,
      [`${step}_completed_at`]: new Date().toISOString(),
    })
    .eq('id', session.id)
    .eq(`${step}_completed`, false)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: 'Could not complete step.' };

  // Determine if the resource is now fully unlocked.
  const { data: fresh } = await admin
    .from('download_sessions')
    .select('subscribe_completed, like_completed, downloads:download_id (require_subscribe, require_like)')
    .eq('id', session.id)
    .single();

  const reqs: { require_subscribe: boolean; require_like: boolean } | null = (fresh as any)?.downloads ?? null;
  const subDone = !reqs?.require_subscribe || !!fresh?.subscribe_completed;
  const likeDone = !reqs?.require_like || !!fresh?.like_completed;
  const unlocked = subDone && likeDone;

  if (unlocked && !session.unlocked) {
    // Note: we do NOT set unlocked_at here — that field is reserved for
    // first-download idempotency (see /api/download/[slug]/route.ts).
    await admin.from('download_sessions').update({ unlocked: true }).eq('id', session.id);
  }

  return { ok: true, data: { unlocked } };
}
