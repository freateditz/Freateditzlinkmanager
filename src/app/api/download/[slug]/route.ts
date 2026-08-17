import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const COOKIE_NAME = 'gateway_session';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return new NextResponse('Begin the download flow first.', { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: session } = await admin
    .from('download_sessions')
    .select('id, unlocked, unlocked_at, download_id, downloads:download_id (id, slug, active, deleted_at, mediafire_url, require_subscribe, require_like)')
    .eq('session_token', token)
    .maybeSingle();

  type Sess = {
    id: string;
    unlocked: boolean;
    unlocked_at: string | null;
    download_id: string;
    downloads: {
      id: string;
      slug: string;
      active: boolean;
      deleted_at: string | null;
      mediafire_url: string;
      require_subscribe: boolean;
      require_like: boolean;
    } | null;
  };
  const s = session as unknown as Sess | null;

  if (!s) return new NextResponse('Session not found.', { status: 401 });
  if (!s.downloads) return new NextResponse('Resource not found.', { status: 404 });
  if (s.downloads.slug !== slug) {
    return new NextResponse('Session does not match this resource.', { status: 403 });
  }
  if (s.downloads.deleted_at || !s.downloads.active) {
    return new NextResponse('Resource unavailable.', { status: 404 });
  }
  if (!s.unlocked) {
    return new NextResponse('All steps not completed.', { status: 403 });
  }

  // Idempotency: only redirect the FIRST successful download for this session.
  // We use unlocked_at as the marker; if it's already set we've already redirected.
  if (s.unlocked_at) {
    return new NextResponse('Download already claimed for this session.', { status: 410 });
  }

  // Atomically set unlocked_at only if it was null. Use a fresh update keyed off the row id.
  const { data: claimed } = await admin
    .from('download_sessions')
    .update({ unlocked_at: new Date().toISOString() })
    .eq('id', s.id)
    .is('unlocked_at', null)
    .select('id')
    .maybeSingle();

  if (!claimed) {
    return new NextResponse('Download already claimed for this session.', { status: 410 });
  }

  // Atomic increment of the global download counter.
  await admin.rpc('increment_download_count', { row_id: s.downloads.id });

  return NextResponse.redirect(s.downloads.mediafire_url, { status: 302 });
}
