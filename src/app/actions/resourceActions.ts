'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { generateUniqueSlug } from '@/lib/slug';
import { resourceSchema } from '@/lib/validations';

export type ResourceActionResult =
  | { ok: true; id?: string; data?: unknown }
  | { ok: false; error: string };

// Slug generation lives in `@/lib/slug` so the one-off importer
// (scripts/import-resources.ts) can reuse the same logic.

export async function createResource(input: unknown): Promise<ResourceActionResult> {
  await requireAdmin();

  const parsed = resourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const data = parsed.data;

  const admin = getSupabaseAdmin();
  const slug = await generateUniqueSlug(data.name);

  const { data: created, error } = await admin
    .from('downloads')
    .insert({
      name: data.name,
      slug,
      mediafire_url: data.mediafire_url,
      // YouTube URLs are global site config (env vars) — no longer per-resource.
      // The legacy columns are left untouched on this and existing rows so
      // historical data is preserved; the runtime never reads them.
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
      // YouTube URLs are global site config — no longer per-resource.
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
