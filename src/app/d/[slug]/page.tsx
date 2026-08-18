import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { Wordmark } from '@/components/brand/Wordmark';
import { Gateway } from '@/components/gateway/Gateway';

export const dynamic = 'force-dynamic';

export default async function GatewayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = getSupabaseAdmin();

  // NOTE: youtube_channel_url and youtube_video_url are intentionally NOT
  // selected. The public gateway reads them from the global YouTube config
  // (NEXT_PUBLIC_YOUTUBE_CHANNEL_URL / NEXT_PUBLIC_YOUTUBE_VIDEO_URL) at
  // runtime, not from this row.
  const { data: download } = await admin
    .from('downloads')
    .select('id, name, slug, require_subscribe, require_like, active, deleted_at')
    .eq('slug', slug)
    .is('deleted_at', null)
    .eq('active', true)
    .maybeSingle();

  if (!download) notFound();

  return (
    <main className="min-h-screen px-4 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-xl">
        <header className="flex flex-col items-center text-center mb-10">
          <Wordmark />
          <h1 className="mt-8 text-2xl sm:text-3xl font-semibold tracking-tight text-text-primary">
            {download.name}
          </h1>
          <p className="mt-2 text-sm text-text-muted max-w-sm">
            Complete the steps below to unlock your download.
          </p>
        </header>

        <Gateway
          download={{
            id: download.id,
            name: download.name,
            slug: download.slug,
            require_subscribe: !!download.require_subscribe,
            require_like: !!download.require_like,
          }}
        />

        <footer className="mt-10 text-center text-xs text-text-muted">
          Having trouble? Refresh the page to restart the flow.
        </footer>
      </div>
    </main>
  );
}
