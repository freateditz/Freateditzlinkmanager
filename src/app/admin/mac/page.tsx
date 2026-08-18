import Link from 'next/link';
import { requireAdmin } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { AdminShell } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui';
import { ResourcesList, type ListResource } from '@/components/admin/ResourcesList';
import type { Platform } from '@/lib/validations';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ q?: string; filter?: 'all' | 'active' | 'inactive' }>;

function normaliseRow(raw: any): ListResource | null {
  if (!raw) return null;
  const list = Array.isArray(raw.counterpart) ? raw.counterpart : raw.counterpart ? [raw.counterpart] : [];
  const cp = list[0] ?? null;
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    platform: raw.platform as Platform,
    active: !!raw.active,
    download_count: Number(raw.download_count) || 0,
    require_subscribe: !!raw.require_subscribe,
    require_like: !!raw.require_like,
    created_at: raw.created_at,
    counterpart_id: raw.counterpart_id ?? null,
    counterpart_slug: cp?.slug ?? null,
    counterpart_name: cp?.name ?? null,
  };
}

export default async function MacResourcesPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireAdmin();
  const { q, filter = 'all' } = await searchParams;
  const admin = getSupabaseAdmin();

  let query = admin
    .from('downloads')
    .select(
      'id, name, slug, platform, active, download_count, require_subscribe, require_like, created_at, counterpart_id, counterpart:counterpart_id (slug, name, platform)'
    )
    .eq('platform', 'mac')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (q) {
    const safe = q.replace(/[%,()]/g, '');
    query = query.or(`name.ilike.%${safe}%,slug.ilike.%${safe}%`);
  }
  if (filter === 'active') query = query.eq('active', true);
  if (filter === 'inactive') query = query.eq('active', false);

  const { data } = await query;
  const rows = ((data ?? []) as any[]).map(normaliseRow).filter((r): r is ListResource => r !== null);

  return (
    <AdminShell userEmail={user.email}>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Mac Resources</h1>
          <p className="mt-1 text-sm text-text-muted">Manage Mac download resources.</p>
        </div>
        <Link href="/admin/mac/new">
          <Button>+ Add Mac Resource</Button>
        </Link>
      </header>

      <div className="rounded-2xl border border-border-subtle bg-bg-surface/40 overflow-hidden">
        <form className="flex flex-col gap-3 sm:flex-row sm:items-center px-4 py-3 border-b border-border-subtle">
          <div className="relative flex-1">
            <svg
              viewBox="0 0 24 24"
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
            </svg>
            <input
              name="q"
              defaultValue={q ?? ''}
              placeholder="Search by name or slug…"
              className="w-full h-9 rounded-lg bg-bg-elevated border border-border pl-9 pr-3 text-sm placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex gap-1 rounded-lg border border-border bg-bg-elevated p-0.5">
            {(['all', 'active', 'inactive'] as const).map((opt) => {
              const active = filter === opt;
              const label = opt === 'all' ? 'All' : opt === 'active' ? 'Active' : 'Inactive';
              return (
                <Link
                  key={opt}
                  href={`/admin/mac?${new URLSearchParams({ ...(q ? { q } : {}), filter: opt }).toString()}`}
                  className={[
                    'h-8 px-3 rounded-md text-xs font-medium inline-flex items-center',
                    active ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-primary',
                  ].join(' ')}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </form>
      </div>

      <div className="mt-4">
        <ResourcesList resources={rows} platform="mac" />
      </div>
    </AdminShell>
  );
}
