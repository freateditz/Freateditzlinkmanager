-- Add deleted_at to downloads
alter table public.downloads add column deleted_at timestamptz;

-- Update RLS to filter out deleted items
drop policy "Admins have full access to downloads" on public.downloads;

create policy "Admins have full access to downloads" on public.downloads
  for all to authenticated
  using (true)
  with check (true);
