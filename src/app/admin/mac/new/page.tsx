import Link from 'next/link';
import { requireAdmin } from '@/lib/auth-server';
import { AdminShell } from '@/components/admin/AdminShell';
import { ResourceForm } from '@/components/admin/ResourceForm';

export const dynamic = 'force-dynamic';

export default async function NewMacResourcePage() {
  const { user } = await requireAdmin();
  return (
    <AdminShell userEmail={user.email}>
      <header className="mb-6 flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wider text-text-muted">
          <Link href="/admin/mac" className="hover:text-text-primary">
            Mac
          </Link>{' '}
          / New
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Create Mac Resource</h1>
        <p className="mt-1 text-sm text-text-muted">
          Add a new Mac download to the gateway. You can optionally link it to a Windows counterpart after creation.
        </p>
      </header>
      <ResourceForm mode="create" platform="mac" />
    </AdminShell>
  );
}
