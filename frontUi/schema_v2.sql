-- ============================================================
-- Raqeeb Schema v2
-- Run this in Supabase SQL Editor AFTER schema_updates.sql
-- ============================================================

-- ============================================================
-- 1. Extend sessions: add scheduling fields + status
-- ============================================================
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS course_name        text,
  ADD COLUMN IF NOT EXISTS exam_start         timestamptz,
  ADD COLUMN IF NOT EXISTS exam_end           timestamptz,
  ADD COLUMN IF NOT EXISTS actual_started_at  timestamptz,
  ADD COLUMN IF NOT EXISTS actual_ended_at    timestamptz,
  ADD COLUMN IF NOT EXISTS status             text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'ended'));

-- ============================================================
-- 2. Replace old unique index: one pending-or-active session per TA
-- ============================================================
DROP INDEX IF EXISTS uq_one_active_session_per_ta;

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_session_per_ta
  ON public.sessions (ta_id)
  WHERE status IN ('pending', 'active');

-- ============================================================
-- 3. Add session_id to espData so detections are unique per session
-- ============================================================
ALTER TABLE public."espData"
  ADD COLUMN IF NOT EXISTS session_id uuid
    REFERENCES public.sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_espdata_session_id
  ON public."espData" (session_id);

-- ============================================================
-- 4. Trigger: auto-stamp new espData rows with the active session
--    (runs BEFORE INSERT so session_id is set immediately)
-- ============================================================
CREATE OR REPLACE FUNCTION public.stamp_detection_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.session_id IS NULL THEN
    SELECT id INTO NEW.session_id
    FROM public.sessions
    WHERE status = 'active'
    ORDER BY actual_started_at DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_espdata_insert ON public."espData";
CREATE TRIGGER on_espdata_insert
  BEFORE INSERT ON public."espData"
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_detection_session();

-- ============================================================
-- 5. Sessions RLS: teachers INSERT/manage their own sessions
-- ============================================================
DROP POLICY IF EXISTS "sessions: teacher read"   ON public.sessions;
DROP POLICY IF EXISTS "sessions: teacher manage"  ON public.sessions;

CREATE POLICY "sessions: teacher manage" ON public.sessions
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'teacher')
    AND teacher_id = auth.uid()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'teacher')
    AND teacher_id = auth.uid()
  );

-- ============================================================
-- 6. Sessions RLS: TAs can only view + update their own sessions
-- ============================================================
DROP POLICY IF EXISTS "sessions: ta manage own"   ON public.sessions;
DROP POLICY IF EXISTS "sessions: ta view own"     ON public.sessions;
DROP POLICY IF EXISTS "sessions: ta update own"   ON public.sessions;

CREATE POLICY "sessions: ta view own" ON public.sessions
  FOR SELECT TO authenticated
  USING (ta_id = auth.uid());

CREATE POLICY "sessions: ta update own" ON public.sessions
  FOR UPDATE TO authenticated
  USING (ta_id = auth.uid())
  WITH CHECK (ta_id = auth.uid());

-- ============================================================
-- 7. Add course_name to reports (denormalized for fast display)
-- ============================================================
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS course_name text;

-- ============================================================
-- 8. Reports: TAs can INSERT their own reports (on session end)
-- ============================================================
DROP POLICY IF EXISTS "reports: ta insert own" ON public.reports;
CREATE POLICY "reports: ta insert own" ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (ta_id = auth.uid());
