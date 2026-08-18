-- Atomic counterpart link/unlink functions.
--
-- link_counterparts(a, b): updates downloads.counterpart_id on BOTH rows in
-- one statement. Either both rows change or neither does.
--
-- unlink_counterparts(a, b): clears the counterpart pointer on both rows
-- when they currently point at each other. Self-healing: if the state is
-- already consistent, it's a no-op.
--
-- Both functions refuse to no-op when either id is missing or when the
-- pointers would create a self-reference.

create or replace function public.link_counterparts(a uuid, b uuid)
returns void as $$
begin
  if a = b then
    raise exception 'A resource cannot be its own counterpart.';
  end if;

  -- Clear any prior counterpart on either side so the relationship is
  -- always pairwise. Set both sides in one statement.
  update public.downloads
  set counterpart_id = case
    when id = a then b
    when id = b then a
  end
  where id in (a, b);
end;
$$ language plpgsql;

create or replace function public.unlink_counterparts(a uuid, b uuid)
returns void as $$
begin
  update public.downloads
  set counterpart_id = null
  where id in (a, b)
    and (
      (id = a and counterpart_id = b)
      or (id = b and counterpart_id = a)
    );
end;
$$ language plpgsql;
