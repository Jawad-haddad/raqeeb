-- ============================================================
-- Raqeeb Schema — run this in Supabase SQL Editor
-- ============================================================

-- 1. User roles
create table if not exists public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null unique,
  role       text not null default 'assistant'
               check (role in ('teacher', 'assistant')),
  created_at timestamptz default now()
);

-- 2. Invitations (teacher pre-registers users)
create table if not exists public.invitations (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  role       text not null default 'assistant'
               check (role in ('teacher', 'assistant')),
  created_by uuid references auth.users(id) on delete set null,
  used       boolean default false,
  created_at timestamptz default now()
);

-- 3. Comments (linked to detections by MAC address)
create table if not exists public.comments (
  id             uuid primary key default gen_random_uuid(),
  detection_mac  text not null,
  author_id      uuid references auth.users(id) on delete set null,
  author_email   text,
  content        text not null,
  created_at     timestamptz default now()
);

-- 4. Extend espData with note + status
alter table public."espData"
  add column if not exists note   text,
  add column if not exists status text default 'active'
    check (status in ('active', 'resolved', 'flagged'));

-- ============================================================
-- 5. Trigger: assign role automatically on new user signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_roles (user_id, role)
  values (
    new.id,
    coalesce(
      (
        select role
        from public.invitations
        where lower(email) = lower(new.email)
          and used = false
        limit 1
      ),
      'assistant'
    )
  )
  on conflict (user_id) do nothing;

  update public.invitations
  set used = true
  where lower(email) = lower(new.email);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- 6. Enable RLS
-- ============================================================
alter table public.user_roles  enable row level security;
alter table public.invitations enable row level security;
alter table public.comments    enable row level security;

-- Uncomment if espData doesn't already have RLS:
-- alter table public."espData" enable row level security;

-- ============================================================
-- 7. RLS — user_roles
-- ============================================================
drop policy if exists "roles: authenticated read" on public.user_roles;
create policy "roles: authenticated read" on public.user_roles
  for select to authenticated using (true);

drop policy if exists "roles: teachers insert" on public.user_roles;
create policy "roles: teachers insert" on public.user_roles
  for insert to authenticated
  with check (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'teacher'
    )
  );

-- ============================================================
-- 8. RLS — invitations (teachers only)
-- ============================================================
drop policy if exists "invitations: teachers all" on public.invitations;
create policy "invitations: teachers all" on public.invitations
  for all to authenticated
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'teacher'
    )
  )
  with check (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'teacher'
    )
  );

-- ============================================================
-- 9. RLS — comments
-- ============================================================
drop policy if exists "comments: authenticated read" on public.comments;
create policy "comments: authenticated read" on public.comments
  for select to authenticated using (true);

drop policy if exists "comments: teachers insert" on public.comments;
create policy "comments: teachers insert" on public.comments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'teacher'
    )
  );

drop policy if exists "comments: teachers delete" on public.comments;
create policy "comments: teachers delete" on public.comments
  for delete to authenticated
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'teacher'
    )
  );

-- ============================================================
-- 10. RLS — espData
-- ============================================================
drop policy if exists "espData: authenticated read" on public."espData";
create policy "espData: authenticated read" on public."espData"
  for select to authenticated using (true);

drop policy if exists "espData: teachers delete" on public."espData";
create policy "espData: teachers delete" on public."espData"
  for delete to authenticated
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'teacher'
    )
  );

drop policy if exists "espData: teachers update" on public."espData";
create policy "espData: teachers update" on public."espData"
  for update to authenticated
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'teacher'
    )
  )
  with check (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'teacher'
    )
  );

-- ============================================================
-- NOTE: Run schema_updates.sql AFTER this file to add:
--   halls, courses, hall_assignments, sessions, reports tables
--   and to migrate roles (assistant → ta, add admin).
-- ============================================================

-- ============================================================
-- AFTER RUNNING: manually promote your existing admin user:
--
--   insert into public.user_roles (user_id, role)
--   values ('<YOUR_USER_UUID>', 'teacher')
--   on conflict (user_id) do update set role = 'teacher';
--
-- Find your UUID in: Supabase dashboard → Authentication → Users
-- ============================================================
