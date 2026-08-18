// Shared shape returned by the admin listings / edit pages. Counterpart
// fields are nullable; on the public gateway we expose the counterpart slug
// so we can deep-link to /d/<slug> without exposing any other internal id.
export interface DownloadResource {
  id: string;
  name: string;
  slug: string;
  platform: 'windows' | 'mac';
  mediafire_url: string;
  require_subscribe: boolean;
  require_like: boolean;
  active: boolean;
  download_count: number;
  created_at: string;
  // Counterpart join populated by the server when known. We only expose the
  // slug on the public gateway — internal ids are admin-only.
  counterpart_id: string | null;
  counterpart_slug?: string | null;
  counterpart_name?: string | null;
}

export interface DownloadSession {
  id: string;
  download_id: string;
  session_token: string;
  subscribe_started_at: string | null;
  subscribe_completed: boolean;
  like_started_at: string | null;
  like_completed: boolean;
  unlocked: boolean;
  expires_at: Date;
}
