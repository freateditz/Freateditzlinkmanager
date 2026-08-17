// Server-side Supabase clients.
// - createServerClient (anon, cookie-bound) for reading the user's session in RSC / actions.
// - admin (service role) for privileged reads/writes that bypass RLS.
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { SUPABASE_URL, SUPABASE_ANON_KEY, getSupabaseServiceRole } from './env';

export async function getSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // called from a Server Component; ignore
        }
      },
    },
  });
}

export function getSupabaseAdmin() {
  return createClient(SUPABASE_URL, getSupabaseServiceRole(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
