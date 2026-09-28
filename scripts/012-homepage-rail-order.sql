-- Homepage SECTION (rail container) ordering.
--
-- This controls ONLY the order in which the six homepage rail containers
-- render on the public homepage. It is deliberately separate from
-- `campaign_homepage_placements`, which remains the sole owner of campaign
-- MEMBERSHIP and campaign ORDER WITHIN each rail. Nothing here touches
-- classification, eligibility, hidden state, hero, or LIVE takeover.
--
-- Backwards-safe: if this table is empty/absent the application falls back to
-- the HOMEPAGE_RAILS constant order, so the homepage can never go blank because
-- of this config.

create table if not exists public.homepage_rail_order (
  rail text primary key
    constraint homepage_rail_order_rail_valid
    check (rail in ('featured', 'balloon_pop', 'instant_cash', 'games', 'cash', 'luxury')),
  position integer not null
    constraint homepage_rail_order_position_nonneg check (position >= 0),
  updated_at timestamptz not null default now(),
  -- Section order must be deterministic at the DB level: no two rails may
  -- share a position. The RPC below shifts existing rows out of the live
  -- 0..5 range before rewriting them so a reorder/swap never transiently
  -- collides with this constraint.
  constraint homepage_rail_order_position_unique unique (position)
);

-- Older deployments may already have the table without this constraint; add it
-- idempotently so re-running this migration converges to the same schema.
alter table public.homepage_rail_order
  drop constraint if exists homepage_rail_order_position_unique;
alter table public.homepage_rail_order
  add constraint homepage_rail_order_position_unique unique (position);

-- Seed the current production order (matches the HOMEPAGE_RAILS constant).
insert into public.homepage_rail_order (rail, position) values
  ('featured', 0),
  ('balloon_pop', 1),
  ('instant_cash', 2),
  ('games', 3),
  ('cash', 4),
  ('luxury', 5)
on conflict (rail) do nothing;

-- Read access: the PUBLIC homepage reads this via the cookie-free anon client,
-- the admin screen via the service client. Writes are ONLY ever performed by
-- the security-definer RPC below (called server-side with the service role);
-- there is intentionally no RLS write policy.
alter table public.homepage_rail_order enable row level security;

drop policy if exists homepage_rail_order_read on public.homepage_rail_order;
create policy homepage_rail_order_read
  on public.homepage_rail_order
  for select
  using (true);

grant select on public.homepage_rail_order to anon, authenticated;

-- Atomic full-order save. Accepts the COMPLETE ordered list of the six rail
-- keys and writes positions 0..5 in a single transaction (the function body).
-- The client can never issue six independent writes.
--
-- Validation (mirrors the app-layer validator):
--   * exactly six rails
--   * no duplicates
--   * no unknown rails
-- Because six distinct valid rails is only satisfiable by the full known set,
-- these three checks together guarantee every expected rail is present.
create or replace function public.set_homepage_rail_section_order(p_rails text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text[] := array['featured', 'balloon_pop', 'instant_cash', 'games', 'cash', 'luxury'];
  r text;
  idx int;
begin
  if p_rails is null or array_length(p_rails, 1) is distinct from 6 then
    raise exception 'invalid_rail_order: expected 6 rails, got %',
      coalesce(array_length(p_rails, 1), 0);
  end if;

  foreach r in array p_rails loop
    if not (r = any (expected)) then
      raise exception 'invalid_rail_order: unknown rail %', r;
    end if;
  end loop;

  if (select count(distinct x) from unnest(p_rails) as x) <> 6 then
    raise exception 'invalid_rail_order: duplicate rails supplied';
  end if;

  -- Serialise concurrent saves so two admins cannot interleave a partial order.
  perform pg_advisory_xact_lock(hashtext('homepage_rail_order'));

  -- `position` is UNIQUE, so assigning the new 0..5 values directly could
  -- transiently collide with an existing row (e.g. swapping two rails would
  -- momentarily give two rails the same position). Move every existing row
  -- OUT of the live 0..5 range first (into 100+), then write the requested
  -- order back into 0..5. Both steps run in this one function transaction, so
  -- the public homepage never observes the temporary values.
  update public.homepage_rail_order
    set position = position + 100
    where position < 100;

  for idx in 1 .. array_length(p_rails, 1) loop
    insert into public.homepage_rail_order (rail, position, updated_at)
    values (p_rails[idx], idx - 1, now())
    on conflict (rail) do update
      set position = excluded.position,
          updated_at = excluded.updated_at;
  end loop;
end;
$$;

-- Only the service role (used server-side by the admin API) may execute the
-- mutation. Public/authenticated clients cannot reorder sections directly.
revoke all on function public.set_homepage_rail_section_order(text[]) from public;
grant execute on function public.set_homepage_rail_section_order(text[]) to service_role;
