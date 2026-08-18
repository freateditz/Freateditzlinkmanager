import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { Wordmark } from '@/components/brand/Wordmark';
import { Gateway } from '@/components/gateway/Gateway';

export const dynamic = 'force-dynamic';

export default async function GatewayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = getSupabaseAdmin();

  // NOTE: youtube_channel_url, youtube_video_url, and mediafire_url are
  // intentionally NOT selected. The public gateway:
  //   - reads YouTube URLs from the global YouTube config env vars
  //   - resolves the actual MediaFire URL only at /api/download/[slug],
  //     after the visitor has unlocked their session.
  //
  // We DO select `platform` and the counterpart's slug (only slug + name,
  // not mediafire_url) so we can render the "Available for <other>" link
  // without exposing anything sensitive.
  const { data: download } = await admin
    .from('downloads')
    .select(
      'id, name, slug, platform, require_subscribe, require_like, active, deleted_at, counterpart_id, counterpart:counterpart_id (slug, name, platform)'
    )
    .eq('slug', slug)
    .is('deleted_at', null)
    .eq('active', true)
    .maybeSingle();

  if (!download) notFound();

  type Counter = { slug: string; name: string; platform: 'windows' | 'mac' } | null;
  const cpRaw = (download as { counterpart: unknown }).counterpart;
  const cpList = Array.isArray(cpRaw) ? cpRaw : cpRaw ? [cpRaw] : [];
  const counterpart = (cpList[0] ?? null) as Counter;

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
            platform: (download as { platform: 'windows' | 'mac' }).platform,
            require_subscribe: !!download.require_subscribe,
            require_like: !!download.require_like,
            counterpart: counterpart
              ? {
                  slug: counterpart.slug,
                  name: counterpart.name,
                  platform: counterpart.platform,
                }
              : null,
          }}
        />

        <footer className="mt-10 text-center text-xs text-text-muted">
          Having trouble? Refresh the page to restart the flow.
        </footer>
      </div>
    </main>
  );
}
