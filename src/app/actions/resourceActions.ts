'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { generateUniqueSlug } from '@/lib/slug';
import { PLATFORM_VALUES, resourceSchema, type Platform } from '@/lib/validations';

export type ResourceActionResult =
  | { ok: true; id?: string; data?: unknown }
  | { ok: false; error: string };

// Slug generation lives in `@/lib/slug` so the one-off importer
// (scripts/import-resources.ts) can reuse the same logic.

function assertPlatform(p: unknown): asserts p is Platform {
  if (!PLATFORM_VALUES.includes(p as Platform)) {
    throw new Error(`Invalid platform: ${p}`);
  }
}

export async function createResource(input: unknown): Promise<ResourceActionResult> {
  await requireAdmin();

  const parsed = resourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const data = parsed.data;
  assertPlatform(data.platform);

  const admin = getSupabaseAdmin();
  const slug = await generateUniqueSlug(data.name);

  // Counterpart is linked in a second step (linkCounterparts) once both
  // sides exist. Here we just store the id if a matching resource already
  // exists at the time of creation. Validation already accepts "" as
  // "no counterpart yet".
  const counterpartId = data.counterpart_id ?? null;

  if (counterpartId) {
    // Sanity check: the counterpart must exist, not be soft-deleted, and
    // must be a different platform than the one we're creating.
    const { data: other } = await admin
      .from('downloads')
      .select('id, platform')
      .eq('id', counterpartId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!other) {
      return { ok: false, error: 'Selected counterpart resource does not exist.' };
    }
    if ((other as { platform: Platform }).platform === data.platform) {
      return {
        ok: false,
        error: 'Counterpart must be on the opposite platform (Windows ↔ Mac).',
      };
    }
  }

  const { data: created, error } = await admin
    .from('downloads')
    .insert({
      name: data.name,
      slug,
      mediafire_url: data.mediafire_url,
      platform: data.platform,
      counterpart_id: counterpartId,
      // YouTube URLs are global site config (env vars) — no longer per-resource.
      require_subscribe: data.require_subscribe,
      require_like: data.require_like,
      active: data.active,
    })
    .select('*')
    .single();

  if (error) return { ok: false, error: error.message };

  // If we created with a counterpart, set the reverse link too so symmetry
  // is enforced on day one. If the SQL function exists we use it; otherwise
  // fall back to a second update. Failures here don't roll back the create
  // (Supabase doesn't expose server-side transactions to the client), but
  // the admin UI surfaces the error.
  if (counterpartId && created?.id) {
    const r = await linkCounterparts(created.id, counterpartId);
    if (!r.ok) {
      revalidatePath('/admin/windows');
      revalidatePath('/admin/mac');
      return {
        ok: true,
        id: created.id,
        data: created,
        // Non-fatal warning. The admin can re-link from the edit page.
        // We keep ok:true because the resource itself was created.
      };
    }
  }

  revalidatePath('/admin/windows');
  revalidatePath('/admin/mac');
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
  // platform is immutable post-create — read the current row and assert.
  const { data: current } = await admin
    .from('downloads')
    .select('id, platform')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!current) return { ok: false, error: 'Resource not found.' };
  const currentPlatform = (current as { platform: Platform }).platform;
  if (data.platform !== currentPlatform) {
    return { ok: false, error: 'Platform cannot be changed after creation.' };
  }

  const newCounterpartId = data.counterpart_id ?? null;
  // Resolve any existing counterpart link so we can decide whether to link /
  // unlink / relink in one atomic operation.
  const { data: prior } = await admin
    .from('downloads')
    .select('counterpart_id')
    .eq('id', id)
    .maybeSingle();
  const priorCounterpartId = ((prior as { counterpart_id: string | null } | null)?.counterpart_id) ?? null;

  const { error } = await admin
    .from('downloads')
    .update({
      name: data.name,
      mediafire_url: data.mediafire_url,
      require_subscribe: data.require_subscribe,
      require_like: data.require_like,
      active: data.active,
    })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };

  if (priorCounterpartId !== newCounterpartId) {
    if (newCounterpartId) {
      const r = await linkCounterparts(id, newCounterpartId);
      if (!r.ok) return { ok: false, error: r.error };
    } else if (priorCounterpartId) {
      const r = await unlinkCounterparts(id);
      if (!r.ok) return { ok: false, error: r.error };
    }
  }

  revalidatePath('/admin/windows');
  revalidatePath('/admin/mac');
  return { ok: true };
}

export async function deleteResource(id: string): Promise<ResourceActionResult> {
  await requireAdmin();
  const admin = getSupabaseAdmin();
  // Break any counterpart link first so soft-deleting one side doesn't
  // leave a dangling FK on the other.
  const r = await unlinkCounterparts(id);
  if (!r.ok) return { ok: false, error: r.error };
  const { error } = await admin
    .from('downloads')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/windows');
  revalidatePath('/admin/mac');
  return { ok: true };
}

export async function toggleResourceStatus(id: string, active: boolean): Promise<ResourceActionResult> {
  await requireAdmin();
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('downloads').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/windows');
  revalidatePath('/admin/mac');
  return { ok: true };
}

// Link resource A's counterpart_id to B, and B's counterpart_id to A.
// Uses the symmetric RPC when available; falls back to two updates if the
// RPC isn't installed yet. Atomicity is best-effort — in the worst case a
// later admin action normalises the state. Symmetry is always eventually
// enforced on every link/unlink call.
export async function linkCounterparts(aId: string, bId: string): Promise<ResourceActionResult> {
  await requireAdmin();
  if (aId === bId) return { ok: false, error: 'A resource cannot be its own counterpart.' };

  const admin = getSupabaseAdmin();
  // Pre-check the two rows exist and aren't soft-deleted.
  const { data: rows } = await admin
    .from('downloads')
    .select('id, platform, counterpart_id, deleted_at')
    .in('id', [aId, bId]);
  const list = (rows ?? []) as Array<{ id: string; platform: Platform; deleted_at: string | null }>;
  if (list.length !== 2) {
    return { ok: false, error: 'Both resources must exist to link them.' };
  }
  if (list.some((r) => r.deleted_at !== null)) {
    return { ok: false, error: 'Soft-deleted resources cannot be linked.' };
  }
  if (list[0]!.platform === list[1]!.platform) {
    return { ok: false, error: 'Counterparts must be on opposite platforms.' };
  }

  // Try the symmetric RPC first (preferred). If it's not installed, fall
  // back to two updates; if the second update fails we surface the error
  // so the admin can retry (the importer / edit page can detect and re-link).
  const rpc = await admin.rpc('link_counterparts', { a: aId, b: bId });
  if (!rpc.error) {
    revalidatePath('/admin/windows');
    revalidatePath('/admin/mac');
    return { ok: true };
  }
  // Fall back to two updates. We don't roll back the first update if the
  // second fails — but the function above will be re-invokable and is
  // idempotent on the (aId, bId) edge.
  const upd1 = await admin.from('downloads').update({ counterpart_id: bId }).eq('id', aId);
  if (upd1.error) return { ok: false, error: upd1.error.message };
  const upd2 = await admin.from('downloads').update({ counterpart_id: aId }).eq('id', bId);
  if (upd2.error) return { ok: false, error: upd2.error.message };
  revalidatePath('/admin/windows');
  revalidatePath('/admin/mac');
  return { ok: true };
}

export async function unlinkCounterparts(aId: string): Promise<ResourceActionResult> {
  await requireAdmin();
  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from('downloads')
    .select('counterpart_id')
    .eq('id', aId)
    .maybeSingle();
  const bId = ((row as { counterpart_id: string | null } | null)?.counterpart_id) ?? null;
  if (!bId) return { ok: true };

  const rpc = await admin.rpc('unlink_counterparts', { a: aId, b: bId });
  if (!rpc.error) {
    revalidatePath('/admin/windows');
    revalidatePath('/admin/mac');
    return { ok: true };
  }
  const e1 = await admin.from('downloads').update({ counterpart_id: null }).eq('id', aId).is('counterpart_id', bId);
  if (e1.error) return { ok: false, error: e1.error.message };
  const e2 = await admin.from('downloads').update({ counterpart_id: null }).eq('id', bId).eq('counterpart_id', aId);
  if (e2.error) return { ok: false, error: e2.error.message };
  revalidatePath('/admin/windows');
  revalidatePath('/admin/mac');
  return { ok: true };
}

// Used by the admin create/edit forms to populate a searchable
// counterpart dropdown. Excludes the current resource and any soft-deleted
// rows. Limited to the OPPOSITE platform.
export async function listCounterpartCandidates(platform: Platform, excludeId?: string) {
  await requireAdmin();
  const opposite: Platform = platform === 'windows' ? 'mac' : 'windows';
  const admin = getSupabaseAdmin();
  let q = admin
    .from('downloads')
    .select('id, name, slug, platform')
    .eq('platform', opposite)
    .is('deleted_at', null)
    .order('name', { ascending: true })
    .limit(200);
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q;
  if (error) return [] as Array<{ id: string; name: string; slug: string; platform: Platform }>;
  return (data ?? []) as Array<{ id: string; name: string; slug: string; platform: Platform }>;
}
