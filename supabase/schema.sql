-- Hearth database setup.
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- Safe to run again later (e.g. after an update).

-- ─── Tables ────────────────────────────────────────────────────────────────

create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Our Home',
  join_code  text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  created_at timestamptz not null default now()
);

-- One row per person. Each person belongs to one household.
create table if not exists public.members (
  user_id      uuid primary key default auth.uid() references auth.users on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  name         text not null check (char_length(name) between 1 and 40),
  joined_at    timestamptz not null default now()
);
create index if not exists members_household_idx on public.members (household_id);

create table if not exists public.items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  kind         text not null check (kind in ('fix', 'routine', 'shopping')),
  title        text not null check (char_length(title) between 1 and 300),
  notes        text not null default '' check (char_length(notes) <= 4000),
  done         boolean not null default false,
  urgent       boolean not null default false,
  due_at       timestamptz,
  repeat       text not null default 'none'
               check (repeat in ('none','daily','weekly','biweekly','monthly','quarterly','semiannual','yearly')),
  assignee     uuid references auth.users on delete set null,
  created_by   uuid default auth.uid() references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  last_done_by uuid references auth.users on delete set null,
  reminded_at  timestamptz          -- set by the reminder job so each due date only notifies once
);
create index if not exists items_household_idx on public.items (household_id);
create index if not exists items_due_idx on public.items (due_at) where not done;

create table if not exists public.pings (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  sender       uuid not null default auth.uid() references auth.users on delete cascade,
  message      text not null check (char_length(message) between 1 and 500),
  item_id      uuid references public.items on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists pings_household_idx on public.pings (household_id, created_at desc);

-- Where to deliver push notifications (one row per phone).
create table if not exists public.push_subscriptions (
  endpoint     text primary key,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- ─── Who can see what ──────────────────────────────────────────────────────
-- Everything is scoped to "the household I'm a member of".

create or replace function public.my_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.members where user_id = auth.uid()
$$;

alter table public.households         enable row level security;
alter table public.members            enable row level security;
alter table public.items              enable row level security;
alter table public.pings              enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "read own household"   on public.households;
drop policy if exists "rename own household" on public.households;
create policy "read own household"   on public.households for select to authenticated using (id = public.my_household());
create policy "rename own household" on public.households for update to authenticated
  using (id = public.my_household()) with check (id = public.my_household());

drop policy if exists "read household members" on public.members;
drop policy if exists "rename myself"          on public.members;
create policy "read household members" on public.members for select to authenticated using (household_id = public.my_household());
create policy "rename myself"          on public.members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and household_id = public.my_household());

drop policy if exists "household items" on public.items;
create policy "household items" on public.items for all to authenticated
  using (household_id = public.my_household()) with check (household_id = public.my_household());

drop policy if exists "read household pings" on public.pings;
drop policy if exists "send pings"           on public.pings;
create policy "read household pings" on public.pings for select to authenticated using (household_id = public.my_household());
create policy "send pings"           on public.pings for insert to authenticated
  with check (household_id = public.my_household() and sender = auth.uid());

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and household_id = public.my_household());

revoke all on public.households, public.members, public.items, public.pings, public.push_subscriptions from anon;
grant select, update                 on public.households         to authenticated;
grant select, update                 on public.members            to authenticated;
grant select, insert, update, delete on public.items              to authenticated;
grant select, insert                 on public.pings              to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ─── Creating and joining a household ─────────────────────────────────────

create or replace function public.create_household(member_name text, household_name text default 'Our Home')
returns public.households
language plpgsql security definer set search_path = '' as $$
declare
  h public.households;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'You are already in a household';
  end if;
  insert into public.households (name)
    values (coalesce(nullif(trim(household_name), ''), 'Our Home'))
    returning * into h;
  insert into public.members (user_id, household_id, name) values (auth.uid(), h.id, trim(member_name));
  return h;
end $$;

create or replace function public.join_household(code text, member_name text)
returns public.households
language plpgsql security definer set search_path = '' as $$
declare
  h      public.households;
  old_id uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  select * into h from public.households where join_code = upper(trim(code));
  if not found then raise exception 'No household has that code. Check it and try again.'; end if;

  select household_id into old_id from public.members where user_id = auth.uid();
  if old_id = h.id then return h; end if;
  if (select count(*) from public.members where household_id = h.id) >= 8 then
    raise exception 'That household is full';
  end if;

  if old_id is not null then
    update public.push_subscriptions set household_id = h.id where user_id = auth.uid();
    if (select count(*) from public.members where household_id = old_id) = 1 then
      -- You were on your own: bring your items along and remove the empty household.
      update public.items set household_id = h.id where household_id = old_id;
      delete from public.members where user_id = auth.uid();
      delete from public.households where id = old_id;
    else
      delete from public.members where user_id = auth.uid();
    end if;
  end if;

  insert into public.members (user_id, household_id, name) values (auth.uid(), h.id, trim(member_name));
  return h;
end $$;

revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.join_household(text, text)   from public, anon;
grant  execute on function public.create_household(text, text) to authenticated;
grant  execute on function public.join_household(text, text)   to authenticated;

-- ─── Live updates ──────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['items', 'members', 'pings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
