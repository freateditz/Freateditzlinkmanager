import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { AdminShell } from '@/components/admin/AdminShell';
import { ResourceForm } from '@/components/admin/ResourceForm';

export const dynamic = 'force-dynamic';

export default async function EditResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireAdmin();
  const admin = getSupabaseAdmin();

  const { data: resource } = await admin
    .from('downloads')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!resource) notFound();

  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');
  const link = `${origin}/d/${resource.slug}`;

  return (
    <AdminShell userEmail={user.email}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Edit Resource</h1>
        <p className="mt-1 text-sm text-text-muted">
          Update the details of <span className="text-text-primary">{resource.name}</span>.
        </p>
      </header>
      <div className="mb-4 rounded-lg border border-border-subtle bg-bg-elevated/40 px-4 py-3">
        <p className="text-xs uppercase tracking-wider text-text-muted">Gateway link (read-only)</p>
        <p className="mt-1 font-mono text-sm text-text-secondary break-all">{link}</p>
        <p className="mt-1 text-xs text-text-muted">Slugs are generated when a resource is created and cannot be edited.</p>
      </div>
      <ResourceForm mode="edit" initial={resource} />
    </AdminShell>
  );
}
