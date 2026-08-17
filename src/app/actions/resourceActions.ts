'use server';

import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { resourceSchema } from '@/lib/validations';

export type ResourceActionResult =
  | { ok: true; id?: string; data?: unknown }
  | { ok: false; error: string };

// URL-safe normaliser. Lowercases, strips diacritics/unsafe chars, collapses
// runs of non-alphanumerics into single hyphens, trims leading/trailing
// hyphens.
function normalizeSlug(input: string) {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// 6-char hex suffix. 24 bits of entropy is plenty for URL uniqueness across
// resources on this site.
function shortId() {
  return randomBytes(3).toString('hex');
}

// Generate a unique slug for `name`. Format: <normalized-name>-<6 hex chars>.
// On the astronomically rare collision, regenerate the suffix and try again.
async function generateUniqueSlug(admin: ReturnType<typeof getSupabaseAdmin>, name: string): Promise<string> {
  const base = normalizeSlug(name) || 'resource';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${shortId()}`;
    const { data } = await admin
      .from('downloads')
      .select('id')
      .eq('slug', candidate)
      .is('deleted_at', null)
      .maybeSingle();
    if (!data) return candidate;
  }
  // Fallback: append timestamp to guarantee uniqueness.
  return `${base}-${shortId()}-${Date.now().toString(36)}`;
}

export async function createResource(input: unknown): Promise<ResourceActionResult> {
  await requireAdmin();

  const parsed = resourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const data = parsed.data;

  const admin = getSupabaseAdmin();
  const slug = await generateUniqueSlug(admin, data.name);

  const { data: created, error } = await admin
    .from('downloads')
    .insert({
      name: data.name,
      slug,
      mediafire_url: data.mediafire_url,
      youtube_channel_url: data.youtube_channel_url || null,
      youtube_video_url: data.youtube_video_url || null,
      require_subscribe: data.require_subscribe,
      require_like: data.require_like,
      active: data.active,
    })
    .select('*')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/resources');
  return { ok: true, id: created.id, data: created };
}

export async function updateResource(id: string, input: unknown): Promise<ResourceActionResult> {
  await requireAdmin();
  const parsed = resourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const data = parsed.data;

  const admin = getSupabaseAdmin();
  // Slug is intentionally NOT updatable here. If the name has changed, the
  // slug stays stable (changing it would break shared links).
  const { error } = await admin
    .from('downloads')
    .update({
      name: data.name,
      mediafire_url: data.mediafire_url,
      youtube_channel_url: data.youtube_channel_url || null,
      youtube_video_url: data.youtube_video_url || null,
      require_subscribe: data.require_subscribe,
      require_like: data.require_like,
      active: data.active,
    })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/resources');
  return { ok: true };
}

export async function deleteResource(id: string): Promise<ResourceActionResult> {
  await requireAdmin();
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('downloads')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/resources');
  return { ok: true };
}

export async function toggleResourceStatus(id: string, active: boolean): Promise<ResourceActionResult> {
  await requireAdmin();
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('downloads').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/resources');
  return { ok: true };
}
