import Link from 'next/link';
import { requireAdmin } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { AdminShell } from '@/components/admin/AdminShell';
import { Card, Badge } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const { user } = await requireAdmin();
  const admin = getSupabaseAdmin();

  const [total, active, downloads, recent] = await Promise.all([
    admin.from('downloads').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    admin.from('downloads').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('active', true),
    admin.from('downloads').select('download_count').is('deleted_at', null),
    admin
      .from('downloads')
      .select('id, name, slug, active, download_count, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const totalDownloads =
    (downloads.data ?? []).reduce((sum, r) => sum + (Number(r.download_count) || 0), 0) || 0;

  return (
    <AdminShell userEmail={user.email}>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Dashboard</h1>
        <p className="mt-1 text-sm text-text-muted">An overview of your gateway resources.</p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Total Resources" value={total.count ?? 0} />
        <Stat label="Active Resources" value={active.count ?? 0} />
        <Stat label="Total Downloads" value={totalDownloads} />
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between mb-4">
          <h2 className="text-base font-semibold text-text-primary">Recent Resources</h2>
          <Link href="/admin/resources" className="text-sm text-accent hover:text-accent-hover">
            View all →
          </Link>
        </div>
        <Card padded={false}>
          {(recent.data ?? []).length === 0 ? (
            <div className="p-8 text-center text-sm text-text-muted">
              No resources yet. Create one to get started.
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {(recent.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{r.name}</p>
                    <p className="text-xs text-text-muted truncate">/d/{r.slug}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-text-muted">{Number(r.download_count) || 0} downloads</span>
                    <Badge variant={r.active ? 'success' : 'warning'}>
                      {r.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">{value}</p>
    </Card>
  );
}
