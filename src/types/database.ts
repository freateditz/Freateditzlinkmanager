export interface DownloadResource {
  id: string;
  name: string;
  slug: string;
  require_subscribe: boolean;
  require_like: boolean;
  youtube_channel_url?: string;
  youtube_video_url?: string;
}

export interface DownloadSession {
  id: string;
  download_id: string;
  session_token: string;
  subscribe_completed: boolean;
  like_completed: boolean;
  unlocked: boolean;
  expires_at: Date;
}
