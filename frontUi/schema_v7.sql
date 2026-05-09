-- ============================================================
-- Raqeeb Schema v7 — Session start fix + TA detections
-- Run in Supabase SQL Editor (safe to re-run)
-- ============================================================


-- ============================================================
-- 1. WHITELIST TABLE (was missing — caused console errors)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.whitelist (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  mac        text        NOT NULL UNIQUE,
  note       text,
  created_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.whitelist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whitelist: authenticated read"  ON public.whitelist;
CREATE POLICY "whitelist: authenticated read" ON public.whitelist
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "whitelist: admin teacher write" ON public.whitelist;
CREATE POLICY "whitelist: admin teacher write" ON public.whitelist
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid() AND role IN ('admin','teacher'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid() AND role IN ('admin','teacher'))
  );


-- ============================================================
-- 2. COLUMN SAFETY (adds columns if any schema step was skipped)
-- ============================================================
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS exam_id      uuid REFERENCES public.exams(id) ON DELETE SET NULL;
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS course_name  text;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS exam_id          uuid REFERENCES public.exams(id) ON DELETE SET NULL;
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS hall_code        text;
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS actual_started_at timestamptz;
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS actual_ended_at   timestamptz;

ALTER TABLE public."espData"
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL;
ALTER TABLE public."espData"
  ADD COLUMN IF NOT EXISTS hall_code  text;

ALTER TABLE public.halls
  ADD COLUMN IF NOT EXISTS hall_code  text;
ALTER TABLE public.halls
  ADD COLUMN IF NOT EXISTS anchor_ids text[];


-- ============================================================
-- 3. UNIQUE INDEXES
-- ============================================================
DROP INDEX IF EXISTS uq_one_active_session_per_ta;
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_session_per_ta
  ON public.sessions (ta_id)
  WHERE status = 'active';

DROP INDEX IF EXISTS uq_one_active_session_per_hall;
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_session_per_hall
  ON public.sessions (hall_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_sessions_ta_id     ON public.sessions  (ta_id);
CREATE INDEX IF NOT EXISTS idx_sessions_hall_code ON public.sessions  (hall_code) WHERE hall_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_espdata_session_id ON public."espData" (session_id);
CREATE INDEX IF NOT EXISTS idx_espdata_hall_code  ON public."espData" (hall_code);


-- ============================================================
-- 4. SESSIONS RLS — clean drop + recreate
-- This is the main reason "Start Session" silently fails:
-- conflicting/missing policies leave TAs unable to UPDATE.
-- ============================================================
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions: admin all"       ON public.sessions;
DROP POLICY IF EXISTS "sessions: teacher read"    ON public.sessions;
DROP POLICY IF EXISTS "sessions: teacher manage"  ON public.sessions;
DROP POLICY IF EXISTS "sessions: ta manage own"   ON public.sessions;
DROP POLICY IF EXISTS "sessions: ta view own"     ON public.sessions;
DROP POLICY IF EXISTS "sessions: ta select own"   ON public.sessions;
DROP POLICY IF EXISTS "sessions: ta update own"   ON public.sessions;

CREATE POLICY "sessions: admin all" ON public.sessions
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

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

-- TA: read their assigned sessions (used by TAHallView to load the session list)
CREATE POLICY "sessions: ta select own" ON public.sessions
  FOR SELECT TO authenticated
  USING (ta_id = auth.uid());

-- TA: update their session (start → active, end → ended)
CREATE POLICY "sessions: ta update own" ON public.sessions
  FOR UPDATE TO authenticated
  USING      (ta_id = auth.uid())
  WITH CHECK (ta_id = auth.uid());


-- ============================================================
-- 5. REPORTS RLS — clean drop + recreate
-- ============================================================
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports: admin all"       ON public.reports;
DROP POLICY IF EXISTS "reports: teacher read"    ON public.reports;
DROP POLICY IF EXISTS "reports: ta read own"     ON public.reports;
DROP POLICY IF EXISTS "reports: ta select own"   ON public.reports;
DROP POLICY IF EXISTS "reports: ta insert own"   ON public.reports;

CREATE POLICY "reports: admin all" ON public.reports
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "reports: teacher read" ON public.reports
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'teacher')
    AND teacher_id = auth.uid()
  );

CREATE POLICY "reports: ta select own" ON public.reports
  FOR SELECT TO authenticated
  USING (ta_id = auth.uid());

CREATE POLICY "reports: ta insert own" ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (ta_id = auth.uid());


-- ============================================================
-- 6. EXAMS RLS — clean drop + recreate
-- ============================================================
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exams: admin all"        ON public.exams;
DROP POLICY IF EXISTS "exams: teacher manage"   ON public.exams;
DROP POLICY IF EXISTS "exams: ta read assigned" ON public.exams;

CREATE POLICY "exams: admin all" ON public.exams
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "exams: teacher manage" ON public.exams
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'teacher')
    AND teacher_id = auth.uid()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'teacher')
    AND teacher_id = auth.uid()
  );

CREATE POLICY "exams: ta read assigned" ON public.exams
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE  s.exam_id = exams.id AND s.ta_id = auth.uid()
    )
  );


-- ============================================================
-- 7. DETECTION ROUTING TRIGGER
-- Routes espData rows to the correct active session.
-- A  = hall_code + exam time window  (new firmware)
-- A2 = hall_code + legacy session    (no exam_id)
-- A3 = hall_code + any active hall session (fallback)
-- B  = anchor_id match               (old firmware)
-- ============================================================
CREATE OR REPLACE FUNCTION public.stamp_detection_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.session_id IS NULL THEN

    IF NEW.hall_code IS NOT NULL THEN
      -- A: hall_code + exam time window
      SELECT s.id INTO NEW.session_id
      FROM   public.sessions s
      JOIN   public.exams    e ON e.id = s.exam_id
      WHERE  s.status    = 'active'
        AND  s.hall_code = NEW.hall_code
        AND  COALESCE(NEW.created_at, now()) BETWEEN e.exam_start AND e.exam_end
      ORDER BY s.actual_started_at DESC
      LIMIT 1;

      -- A2: hall_code + legacy standalone session
      IF NEW.session_id IS NULL THEN
        SELECT id INTO NEW.session_id
        FROM   public.sessions
        WHERE  status    = 'active'
          AND  hall_code = NEW.hall_code
          AND  exam_id   IS NULL
        ORDER BY actual_started_at DESC
        LIMIT 1;
      END IF;

      -- A3: hall_code → any active session in that physical hall
      IF NEW.session_id IS NULL THEN
        SELECT s.id INTO NEW.session_id
        FROM   public.sessions s
        JOIN   public.halls    h ON h.id = s.hall_id
        WHERE  s.status    = 'active'
          AND  h.hall_code = NEW.hall_code
        ORDER BY s.actual_started_at DESC
        LIMIT 1;
      END IF;
    END IF;

    -- B: anchor_id fallback (old ESP firmware)
    IF NEW.session_id IS NULL THEN
      SELECT s.id INTO NEW.session_id
      FROM   public.sessions s
      JOIN   public.halls    h ON h.id = s.hall_id
      WHERE  s.status = 'active'
        AND  (
          h.anchor_ids IS NULL
          OR array_length(h.anchor_ids, 1) IS NULL
          OR NEW.anchor_id = ANY(h.anchor_ids)
        )
      ORDER BY s.actual_started_at DESC
      LIMIT 1;
    END IF;

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
-- 8. DROP VIEWS BEFORE RECREATING (avoids "cannot drop columns" error)
-- ============================================================
DROP VIEW IF EXISTS public.exam_report;
DROP VIEW IF EXISTS public.session_report_with_comments;


-- 8a. Per-session report view
CREATE VIEW public.session_report_with_comments
  WITH (security_invoker = true)
AS
SELECT
  r.id                AS report_id,
  r.session_id,
  r.exam_id,
  r.hall_id,
  r.teacher_id,
  r.ta_id,
  r.course_name,
  r.total_detections,
  r.started_at,
  r.ended_at,
  r.created_at,
  h.name              AS hall_name,
  h.location          AS hall_location,
  h.hall_code,
  h.rows              AS hall_rows,
  h.columns           AS hall_columns,
  e.title             AS exam_title,
  e.exam_start,
  e.exam_end,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'mac',        c.detection_mac,
        'ssid',       d.ssid,
        'block',      d.block_number,
        'comment',    c.content,
        'author',     c.author_email,
        'written_at', c.created_at
      )
      ORDER BY c.created_at
    )
    FROM  public."espData" d
    JOIN  public.comments  c ON c.detection_mac = d.mac::text
    WHERE d.session_id = r.session_id
  ) AS comments
FROM  public.reports     r
LEFT JOIN public.halls   h ON h.id = r.hall_id
LEFT JOIN public.exams   e ON e.id = r.exam_id;


-- 8b. Exam-level report view (one row per exam, halls aggregated)
CREATE VIEW public.exam_report
  WITH (security_invoker = true)
AS
SELECT
  e.id                                        AS exam_id,
  e.title                                     AS exam_title,
  e.course_name,
  e.exam_start,
  e.exam_end,
  e.status                                    AS exam_status,
  e.teacher_id,
  e.created_at,
  COUNT(r.id)                                 AS session_count,
  COALESCE(SUM(r.total_detections), 0)        AS total_detections,
  jsonb_agg(
    jsonb_build_object(
      'report_id',        r.id,
      'session_id',       r.session_id,
      'hall_name',        h.name,
      'hall_code',        h.hall_code,
      'hall_location',    h.location,
      'ta_id',            r.ta_id,
      'total_detections', r.total_detections,
      'started_at',       r.started_at,
      'ended_at',         r.ended_at,
      'comments', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'mac',        c.detection_mac,
            'ssid',       d.ssid,
            'block',      d.block_number,
            'comment',    c.content,
            'author',     c.author_email,
            'written_at', c.created_at
          )
          ORDER BY c.created_at
        )
        FROM  public."espData" d
        JOIN  public.comments  c ON c.detection_mac = d.mac::text
        WHERE d.session_id = r.session_id
      )
    )
    ORDER BY h.name
  ) FILTER (WHERE r.id IS NOT NULL)           AS sessions_breakdown
FROM  public.exams           e
LEFT JOIN public.reports     r ON r.exam_id  = e.id
LEFT JOIN public.halls       h ON h.id       = r.hall_id
GROUP BY
  e.id, e.title, e.course_name, e.exam_start, e.exam_end,
  e.status, e.teacher_id, e.created_at;


-- ============================================================
-- 9. BACK-FILL hall_code ON EXISTING SESSIONS
-- ============================================================
UPDATE public.sessions s
SET    hall_code = h.hall_code
FROM   public.halls h
WHERE  h.id        = s.hall_id
  AND  s.hall_code IS NULL
  AND  h.hall_code IS NOT NULL;
