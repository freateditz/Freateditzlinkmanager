// Server-side helper to read the current admin user, redirecting to login if not authenticated.
import { redirect } from 'next/navigation';
import { getSupabaseServer } from './supabase-server';

export async function requireAdmin() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/admin/login');
  return { supabase, user };
}
