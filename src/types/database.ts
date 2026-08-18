export interface DownloadResource {
  id: string;
  name: string;
  slug: string;
  require_subscribe: boolean;
  require_like: boolean;
  // NOTE: youtube_channel_url / youtube_video_url used to live on each row.
  // They are now global site configuration (NEXT_PUBLIC_YOUTUBE_CHANNEL_URL /
  // NEXT_PUBLIC_YOUTUBE_VIDEO_URL) and are NOT selected from the downloads
  // table at runtime. The legacy columns are kept in the DB for backward
  // compatibility but are never read.
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
