-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Downloads Table
create table public.downloads (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  slug text not null unique,
  mediafire_url text not null,
  youtube_channel_url text,
  youtube_video_url text,
  require_subscribe boolean default false,
  require_like boolean default false,
  active boolean default true,
  download_count int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Download Sessions Table
create table public.download_sessions (
  id uuid default uuid_generate_v4() primary key,
  session_token text not null unique,
  download_id uuid references public.downloads(id) on delete cascade not null,
  subscribe_completed boolean default false,
  subscribe_started_at timestamptz,
  subscribe_completed_at timestamptz,
  like_completed boolean default false,
  like_started_at timestamptz,
  like_completed_at timestamptz,
  unlocked boolean default false,
  unlocked_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- RLS Policy: Downloads
-- Admins have full access (authenticated users with custom claims, or we can check a simple "admin" profile table later).
-- For now, let's assume all authenticated users are admins until we setup the profile.
-- Visitors have no access via SELECT. The server will use service role.
alter table public.downloads enable row level security;

create policy "Admins have full access to downloads" on public.downloads
  for all to authenticated
  using (true)
  with check (true);

-- RLS Policy: Download Sessions
-- Public visitors must NOT directly query this. Server actions will manage this.
alter table public.download_sessions enable row level security;

-- No policies for public. No one gets to read/write this from the browser directly.
