// Slug helpers shared by the admin resource actions and the one-off
// importer (scripts/import-resources.ts). Keeps a single source of truth
// for how we normalise + uniquely-suffix resource names.
import { randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-server';

// URL-safe normaliser. Lowercases, strips diacritics/unsafe chars, collapses
// runs of non-alphanumerics into single hyphens, trims leading/trailing
// hyphens.
export function normalizeSlug(input: string): string {
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
export function shortId(): string {
  return randomBytes(3).toString('hex');
}

// Generate a unique slug for `name`. Format: <normalized-name>-<6 hex chars>.
// On the astronomically rare collision, regenerate the suffix and try again.
//
// Scope: we only consider rows where deleted_at is null. Soft-deleted rows
// do not block a name from being re-used by a fresh import.
export async function generateUniqueSlug(name: string): Promise<string> {
  const admin = getSupabaseAdmin();
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
