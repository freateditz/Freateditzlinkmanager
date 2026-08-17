// Site origin helper. Uses NEXT_PUBLIC_SITE_URL in production, falls back to
// the current request origin (so localhost:3000 works in dev).
export function getSiteOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.replace(/\/+$/, '');
  return '';
}

/**
 * Build an absolute gateway URL. Server context uses NEXT_PUBLIC_SITE_URL when
 * present; otherwise we attempt to derive from headers (e.g. behind a proxy).
 * Client context can also pass its `window.location.origin`.
 */
export function buildGatewayUrl(origin: string, slug: string): string {
  const trimmed = origin.replace(/\/+$/, '');
  return `${trimmed}/d/${slug}`;
}
