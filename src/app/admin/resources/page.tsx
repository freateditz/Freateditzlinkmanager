import Link from 'next/link';
import { requireAdmin } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { AdminShell } from '@/components/admin/AdminShell';
import { Card, Badge, EmptyState, Button } from '@/components/ui';
import { ResourcesTable } from './ResourcesTable';

export const dynamic = 'force-dynamic';

type Search = Promise<{ q?: string; filter?: 'all' | 'active' | 'inactive' }>;

export default async function ResourcesPage({ searchParams }: { searchParams: Search }) {
  const { user } = await requireAdmin();
  const { q, filter = 'all' } = await searchParams;

  const admin = getSupabaseAdmin();
  let query = admin
    .from('downloads')
    .select('id, name, slug, active, download_count, require_subscribe, require_like, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (q) {
    const safe = q.replace(/[%,()]/g, '');
    query = query.or(`name.ilike.%${safe}%,slug.ilike.%${safe}%`);
  }
  if (filter === 'active') query = query.eq('active', true);
  if (filter === 'inactive') query = query.eq('active', false);

  const { data: resources } = await query;
  const list = resources ?? [];

  return (
    <AdminShell userEmail={user.email}>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Resources</h1>
          <p className="mt-1 text-sm text-text-muted">Manage your protected download links.</p>
        </div>
        <Link href="/admin/resources/new">
          <Button>+ Create Resource</Button>
        </Link>
      </header>

      <Card padded={false} className="overflow-hidden">
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
              return (
                <Link
                  key={opt}
                  href={`/admin/resources?${new URLSearchParams({ ...(q ? { q } : {}), filter: opt }).toString()}`}
                  className={[
                    'h-8 px-3 rounded-md text-xs font-medium inline-flex items-center',
                    active ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-primary',
                  ].join(' ')}
                >
                  {opt === 'all' ? 'All' : opt === 'active' ? 'Active' : 'Inactive'}
                </Link>
              );
            })}
          </div>
        </form>

        {list.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No resources found"
              description={q || filter !== 'all' ? 'Try clearing filters or searching for a different term.' : 'Create your first resource to start sharing.'}
              action={
                <Link href="/admin/resources/new">
                  <Button>+ Create Resource</Button>
                </Link>
              }
            />
          </div>
        ) : (
          <ResourcesTable
            resources={list.map((r) => ({
              ...r,
              download_count: Number(r.download_count) || 0,
            }))}
          />
        )}
      </Card>
    </AdminShell>
  );
}
