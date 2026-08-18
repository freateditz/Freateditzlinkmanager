import { redirect } from 'next/navigation';

// Legacy listing — the primary admin entry points are now Windows and Mac.
// Anything still pointing at /admin/resources (an internal admin link, a
// bookmark, etc.) is forwarded to the Windows page so no admin ends up on
// a dead route.
export default function LegacyAdminResourcesPage() {
  redirect('/admin/windows');
}
