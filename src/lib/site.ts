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

// Single source of truth for the V1 timed-completion window. Every flow that
// enforces a server-side minimum wait between "step started" and "step
// completed" MUST read this constant — no other place should hardcode 10000.
export const MIN_STEP_WAIT_MS = 10_000;

// Global YouTube configuration. These are intentionally NEXT_PUBLIC_ values so
// they can be read on the client to open the right external URLs without a
// round-trip. Both must be configured for the gateway to function. We expose
// them through getters so that a missing value surfaces when first accessed
// (e.g. from the public gateway), rather than crashing unrelated routes at
// module load time.

const REQUIRED_HTTPS_PREFIX = 'https://';

function readValidatedHttpsUrl(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required public env: ${name}. Set it to the global YouTube URL in your environment configuration.`
    );
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith(REQUIRED_HTTPS_PREFIX)) {
    throw new Error(
      `${name} must start with ${REQUIRED_HTTPS_PREFIX} — got: "${trimmed}"`
    );
  }
  try {
    // Throws on invalid URLs.
    new URL(trimmed);
  } catch {
    throw new Error(`${name} is not a valid URL — got: "${trimmed}"`);
  }
  return trimmed;
}

export const YOUTUBE = {
  get channelUrl(): string {
    return readValidatedHttpsUrl('NEXT_PUBLIC_YOUTUBE_CHANNEL_URL');
  },
  get videoUrl(): string {
    return readValidatedHttpsUrl('NEXT_PUBLIC_YOUTUBE_VIDEO_URL');
  },
} as const;
