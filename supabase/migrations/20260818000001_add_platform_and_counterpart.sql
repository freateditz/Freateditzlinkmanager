-- Platform + counterpart_id
--
-- Every download now belongs to exactly one platform. Windows and Mac
-- resources can optionally link to their counterpart on the other platform.
--
-- Self-referencing FK with a CHECK to prevent self-reference. Symmetry is
-- enforced by the server actions, not the database (a single direction
-- update can be wrapped in two updates in one transaction from the server).

-- 1. platform
--    Add column nullable first so we don't block existing rows (none
--    currently exist, but this is future-safe), backfill any nulls to a
--    placeholder, then make it NOT NULL with a CHECK constraint.
alter table public.downloads
  add column platform text;

-- Backfill default for the (currently empty) table — this also satisfies the
-- upcoming NOT NULL requirement if any row was inserted between add and
-- alter.
update public.downloads
  set platform = 'windows'
  where platform is null;

alter table public.downloads
  alter column platform set default 'windows',
  alter column platform set not null;

alter table public.downloads
  add constraint downloads_platform_check
  check (platform in ('windows', 'mac'));

-- 2. counterpart_id
alter table public.downloads
  add column counterpart_id uuid;

alter table public.downloads
  add constraint downloads_counterpart_id_fkey
  foreign key (counterpart_id)
  references public.downloads (id)
  on delete set null;

-- Prevent a row from pointing to itself.
alter table public.downloads
  add constraint downloads_counterpart_not_self
  check (counterpart_id is null or counterpart_id <> id);

-- Indexes to keep lookups fast:
--   - listing by platform (Windows / Mac admin pages)
--   - following the counterpart link from either side
create index if not exists downloads_platform_idx
  on public.downloads (platform)
  where deleted_at is null;

create index if not exists downloads_counterpart_id_idx
  on public.downloads (counterpart_id)
  where counterpart_id is not null;

-- Re-apply the admin-owns-everything RLS policy in case the column additions
-- shadowed it on older Postgres versions (defensive; no-op if already set).
drop policy if exists "Admins have full access to downloads" on public.downloads;
create policy "Admins have full access to downloads" on public.downloads
  for all to authenticated
  using (true)
  with check (true);
