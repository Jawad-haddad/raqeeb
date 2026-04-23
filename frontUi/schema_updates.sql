-- ============================================================
-- Raqeeb Schema Updates
-- Run this in Supabase SQL Editor (after schema.sql)
-- ============================================================

-- ============================================================
-- 1. Extend role system: add 'admin' and 'ta', rename 'assistant' -> 'ta'
-- ============================================================

ALTER TABLE public.user_roles  DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.invitations DROP CONSTRAINT IF EXISTS invitations_role_check;

UPDATE public.user_roles  SET role = 'ta' WHERE role = 'assistant';
UPDATE public.invitations SET role = 'ta' WHERE role = 'assistant';

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('admin', 'teacher', 'ta'));

ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('admin', 'teacher', 'ta'));

ALTER TABLE public.user_roles  ALTER COLUMN role SET DEFAULT 'ta';
ALTER TABLE public.invitations ALTER COLUMN role SET DEFAULT 'ta';

-- ============================================================
-- 2. Update trigger to default new users to 'ta'
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    new.id,
    COALESCE(
      (SELECT role FROM public.invitations
       WHERE lower(email) = lower(new.email) AND used = false
       LIMIT 1),
      'ta'
    )
  )
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.invitations
  SET used = true
  WHERE lower(email) = lower(new.email);

  RETURN new;
END;
$$;

-- ============================================================
-- 3. Halls table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.halls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  location    text,
  rows        int  NOT NULL DEFAULT 3,
  columns     int  NOT NULL DEFAULT 3,
  anchor_ref  text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

-- ============================================================
-- 4. Courses table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.courses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

-- ============================================================
-- 5. Hall assignments (teacher assigns TA to hall)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hall_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hall_id     uuid NOT NULL REFERENCES public.halls(id) ON DELETE CASCADE,
  ta_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  teacher_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  active      boolean NOT NULL DEFAULT true,
  assigned_at timestamptz DEFAULT now()
);

-- A TA may only hold one active assignment at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_ta_assignment
  ON public.hall_assignments (ta_id)
  WHERE active = true;

-- ============================================================
-- 6. Sessions table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hall_id     uuid REFERENCES public.halls(id) ON DELETE SET NULL,
  teacher_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ta_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  course_id   uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  started_at  timestamptz DEFAULT now(),
  ended_at    timestamptz,
  created_at  timestamptz DEFAULT now()
);

-- A TA may only have one open session at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_session_per_ta
  ON public.sessions (ta_id)
  WHERE ended_at IS NULL;

-- ============================================================
-- 7. Reports table (generated when TA ends session)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid REFERENCES public.sessions(id) ON DELETE CASCADE,
  hall_id            uuid REFERENCES public.halls(id) ON DELETE SET NULL,
  teacher_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ta_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  course_id          uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  total_detections   int NOT NULL DEFAULT 0,
  flagged_count      int NOT NULL DEFAULT 0,
  resolved_count     int NOT NULL DEFAULT 0,
  active_count       int NOT NULL DEFAULT 0,
  started_at         timestamptz,
  ended_at           timestamptz,
  created_at         timestamptz DEFAULT now()
);

-- ============================================================
-- 8. Ensure espData has created_at (needed for session filtering)
-- ============================================================
ALTER TABLE public."espData"
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- ============================================================
-- 9. Enable RLS on new tables
-- ============================================================
ALTER TABLE public.halls            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hall_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports          ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 10. RLS — halls (admin manages, all authenticated read)
-- ============================================================
DROP POLICY IF EXISTS "halls: authenticated read" ON public.halls;
CREATE POLICY "halls: authenticated read" ON public.halls
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "halls: admin write" ON public.halls;
CREATE POLICY "halls: admin write" ON public.halls
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- ============================================================
-- 11. RLS — courses (admin + teacher manage, all authenticated read)
-- ============================================================
DROP POLICY IF EXISTS "courses: authenticated read" ON public.courses;
CREATE POLICY "courses: authenticated read" ON public.courses
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "courses: admin teacher write" ON public.courses;
CREATE POLICY "courses: admin teacher write" ON public.courses
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','teacher')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','teacher')));

-- ============================================================
-- 12. RLS — hall_assignments
-- ============================================================
DROP POLICY IF EXISTS "hall_assignments: admin all" ON public.hall_assignments;
CREATE POLICY "hall_assignments: admin all" ON public.hall_assignments
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "hall_assignments: teacher manage" ON public.hall_assignments;
CREATE POLICY "hall_assignments: teacher manage" ON public.hall_assignments
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'teacher') AND teacher_id = auth.uid())
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'teacher'));

DROP POLICY IF EXISTS "hall_assignments: ta read own" ON public.hall_assignments;
CREATE POLICY "hall_assignments: ta read own" ON public.hall_assignments
  FOR SELECT TO authenticated
  USING (ta_id = auth.uid());

-- ============================================================
-- 13. RLS — sessions
-- ============================================================
DROP POLICY IF EXISTS "sessions: admin all" ON public.sessions;
CREATE POLICY "sessions: admin all" ON public.sessions
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "sessions: teacher read" ON public.sessions;
CREATE POLICY "sessions: teacher read" ON public.sessions
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'teacher')
    AND teacher_id = auth.uid()
  );

DROP POLICY IF EXISTS "sessions: ta manage own" ON public.sessions;
CREATE POLICY "sessions: ta manage own" ON public.sessions
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'ta') AND ta_id = auth.uid())
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'ta') AND ta_id = auth.uid());

-- ============================================================
-- 14. RLS — reports
-- ============================================================
DROP POLICY IF EXISTS "reports: admin all" ON public.reports;
CREATE POLICY "reports: admin all" ON public.reports
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "reports: teacher read" ON public.reports;
CREATE POLICY "reports: teacher read" ON public.reports
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'teacher')
    AND teacher_id = auth.uid()
  );

DROP POLICY IF EXISTS "reports: ta read own" ON public.reports;
CREATE POLICY "reports: ta read own" ON public.reports
  FOR SELECT TO authenticated
  USING (ta_id = auth.uid());

DROP POLICY IF EXISTS "reports: ta insert own" ON public.reports;
CREATE POLICY "reports: ta insert own" ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (ta_id = auth.uid());

-- ============================================================
-- 15. Update existing espData, comments, user_roles, invitations policies
-- ============================================================

-- espData: admin also gets delete/update
DROP POLICY IF EXISTS "espData: teachers delete"  ON public."espData";
DROP POLICY IF EXISTS "espData: teachers update"  ON public."espData";

CREATE POLICY "espData: admin teacher delete" ON public."espData"
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','teacher')));

CREATE POLICY "espData: admin teacher update" ON public."espData"
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','teacher')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','teacher')));

-- user_roles: admin manages (was teacher-only)
DROP POLICY IF EXISTS "roles: teachers insert" ON public.user_roles;
CREATE POLICY "roles: admin insert" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Allow admin to update roles
DROP POLICY IF EXISTS "roles: admin update" ON public.user_roles;
CREATE POLICY "roles: admin update" ON public.user_roles
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- invitations: admin manages (was teacher-only)
DROP POLICY IF EXISTS "invitations: teachers all" ON public.invitations;
CREATE POLICY "invitations: admin all" ON public.invitations
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- comments: admin, teacher, and TA can insert
DROP POLICY IF EXISTS "comments: teachers insert" ON public.comments;
CREATE POLICY "comments: teacher ta insert" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','teacher','ta')));

-- comments: admin and teacher can delete
DROP POLICY IF EXISTS "comments: teachers delete" ON public.comments;
CREATE POLICY "comments: admin teacher delete" ON public.comments
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','teacher')));

-- ============================================================
-- 16. Promote your first admin (replace UUID below)
-- ============================================================
-- Find your UUID: Supabase Dashboard → Authentication → Users → copy id
--
-- INSERT INTO public.user_roles (user_id, role)
-- VALUES ('<YOUR_UUID_HERE>', 'admin')
-- ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
-- ============================================================
