-- Atomic increment function
create or replace function public.increment_download_count(row_id uuid)
returns void as $$
begin
  update public.downloads
  set download_count = download_count + 1
  where id = row_id;
end;
$$ language plpgsql;
