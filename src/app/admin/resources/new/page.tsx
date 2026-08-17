import { requireAdmin } from '@/lib/auth-server';
import { AdminShell } from '@/components/admin/AdminShell';
import { ResourceForm } from '@/components/admin/ResourceForm';

export const dynamic = 'force-dynamic';

export default async function NewResourcePage() {
  const { user } = await requireAdmin();
  return (
    <AdminShell userEmail={user.email}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Create Resource</h1>
        <p className="mt-1 text-sm text-text-muted">Add a new protected download link to the gateway.</p>
      </header>
      <ResourceForm mode="create" />
    </AdminShell>
  );
}
