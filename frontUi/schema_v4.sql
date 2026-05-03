-- ============================================================
-- Raqeeb Schema v4 — Multi-Hall Exam Support
-- Run in Supabase SQL Editor AFTER schema_v3.sql
-- ============================================================

-- ============================================================
-- SECTION 1 — TABLES
-- ============================================================

-- 1.1  halls.hall_code
-- Short unique code admin assigns when creating a hall.
-- This same code is hard-coded into every ESP device in that hall.
-- ESP sends hall_code in each detection payload → trigger routes
-- the detection to the correct active session automatically.
ALTER TABLE public.halls
  ADD COLUMN IF NOT EXISTS hall_code text;

-- 1.2  exams  (parent of sessions)
-- Teacher creates ONE exam; each hall running it becomes a session.
CREATE TABLE IF NOT EXISTS public.exams (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL,          -- e.g. "CS101 Midterm"
  course_name text,                          -- denormalised for display
  course_id   uuid        REFERENCES public.courses(id)  ON DELETE SET NULL,
  teacher_id  uuid        REFERENCES auth.users(id)      ON DELETE SET NULL,
  exam_start  timestamptz NOT NULL,
  exam_end    timestamptz NOT NULL,
  status      text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'ended')),
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT  exams_end_after_start CHECK (exam_end > exam_start)
);

-- 1.3  sessions.exam_id
-- Links each session to its parent exam.
-- Nullable so existing sessions without an exam are not broken.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS exam_id uuid
    REFERENCES public.exams(id) ON DELETE SET NULL;

-- 1.4  espData.hall_code
-- New ESP firmware includes the hall_code in every payload.
-- Used by the trigger to route the detection to the right session.
ALTER TABLE public."espData"
  ADD COLUMN IF NOT EXISTS hall_code text;

-- 1.5  reports.exam_id
-- Allows report queries to group or filter by exam in one step.
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS exam_id uuid
    REFERENCES public.exams(id) ON DELETE SET NULL;


-- ============================================================
-- SECTION 2 — CONSTRAINTS
-- ============================================================

-- hall_code must be globally unique across all halls
-- (each ESP is physically labelled with one code)
ALTER TABLE public.halls
  DROP CONSTRAINT IF EXISTS halls_hall_code_unique;
ALTER TABLE public.halls
  ADD CONSTRAINT halls_hall_code_unique UNIQUE (hall_code);

-- Relax the TA session constraint.
-- Old rule: one pending-or-active session per TA
--   → blocked pre-assigning a TA to future exams
-- New rule: one ACTIVE session per TA at a time
--   → TAs may have multiple pending sessions (future exams)
DROP INDEX IF EXISTS uq_one_active_session_per_ta;
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_session_per_ta
  ON public.sessions (ta_id)
  WHERE status = 'active';

-- One active session per hall at a time (unchanged from v3)
DROP INDEX IF EXISTS uq_one_active_session_per_hall;
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_session_per_hall
  ON public.sessions (hall_id)
  WHERE status = 'active';


-- ============================================================
-- SECTION 3 — INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_halls_hall_code   ON public.halls     (hall_code);
CREATE INDEX IF NOT EXISTS idx_sessions_exam_id  ON public.sessions  (exam_id);
CREATE INDEX IF NOT EXISTS idx_espdata_hall_code ON public."espData" (hall_code);
CREATE INDEX IF NOT EXISTS idx_reports_exam_id   ON public.reports   (exam_id);
CREATE INDEX IF NOT EXISTS idx_exams_teacher_id  ON public.exams     (teacher_id);
CREATE INDEX IF NOT EXISTS idx_exams_status      ON public.exams     (status);


-- ============================================================
-- SECTION 4 — FUNCTIONS / TRIGGERS
-- ============================================================

-- Updated detection routing.
-- Priority A (new firmware)  : match hall_code + exam time window
-- Priority B (legacy firmware): match anchor_id array (v3 fallback)
CREATE OR REPLACE FUNCTION public.stamp_detection_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.session_id IS NULL THEN

    -- A. hall_code-based routing (new ESP firmware)
    -- Only runs when the payload includes a hall_code.
    IF NEW.hall_code IS NOT NULL THEN
      SELECT s.id INTO NEW.session_id
      FROM   public.sessions s
      JOIN   public.halls    h ON h.id = s.hall_id
      JOIN   public.exams    e ON e.id = s.exam_id
      WHERE  s.status    = 'active'
        AND  h.hall_code = NEW.hall_code
        AND  COALESCE(NEW.created_at, now())
               BETWEEN e.exam_start AND e.exam_end
      ORDER BY s.actual_started_at DESC
      LIMIT 1;
    END IF;

    -- B. Legacy anchor_id fallback (old firmware or hall_code absent)
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

-- Re-register trigger (replaces v3 version)
DROP TRIGGER IF EXISTS on_espdata_insert ON public."espData";
CREATE TRIGGER on_espdata_insert
  BEFORE INSERT ON public."espData"
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_detection_session();


-- ============================================================
-- SECTION 5 — VIEWS
-- ============================================================

-- 5.1  session_report_with_comments
-- One row per session report, enriched with:
--   • hall name, location, hall_code, grid size
--   • exam title and scheduled window
--   • all TA comments on detected devices (as JSON array)
-- The comments column is what the teacher sees in the report —
-- each entry shows which device was flagged, where in the hall,
-- what the TA wrote, and who wrote it.
-- security_invoker = true  → caller's RLS applies to every joined table.
CREATE OR REPLACE VIEW public.session_report_with_comments
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
  r.flagged_count,
  r.resolved_count,
  r.active_count,
  r.started_at,
  r.ended_at,
  r.created_at,

  -- Hall details
  h.name              AS hall_name,
  h.location          AS hall_location,
  h.hall_code,
  h.rows              AS hall_rows,
  h.columns           AS hall_columns,

  -- Exam details
  e.title             AS exam_title,
  e.exam_start,
  e.exam_end,

  -- Comments written on any device detected during this session.
  -- Each object: which device, block location, TA note, who wrote it.
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
  )                   AS comments

FROM  public.reports     r
LEFT JOIN public.halls   h ON h.id = r.hall_id
LEFT JOIN public.exams   e ON e.id = r.exam_id;


-- 5.2  exam_report
-- One row per exam, aggregating counts across all its halls.
-- sessions_breakdown is a JSON array — one entry per hall — so the
-- teacher can drill into any hall and see its TA comments inline.
CREATE OR REPLACE VIEW public.exam_report
  WITH (security_invoker = true)
AS
SELECT
  e.id                              AS exam_id,
  e.title                           AS exam_title,
  e.course_name,
  e.exam_start,
  e.exam_end,
  e.status                          AS exam_status,
  e.teacher_id,
  e.created_at,

  -- Totals across all halls
  COUNT(r.id)                            AS session_count,
  COALESCE(SUM(r.total_detections), 0)   AS total_detections,
  COALESCE(SUM(r.flagged_count),    0)   AS flagged_count,
  COALESCE(SUM(r.resolved_count),   0)   AS resolved_count,
  COALESCE(SUM(r.active_count),     0)   AS active_count,

  -- Per-hall detail with TA comments embedded
  jsonb_agg(
    jsonb_build_object(
      'report_id',        r.id,
      'session_id',       r.session_id,
      'hall_name',        h.name,
      'hall_code',        h.hall_code,
      'hall_location',    h.location,
      'ta_id',            r.ta_id,
      'total_detections', r.total_detections,
      'flagged_count',    r.flagged_count,
      'resolved_count',   r.resolved_count,
      'active_count',     r.active_count,
      'started_at',       r.started_at,
      'ended_at',         r.ended_at,
      -- Comments from this specific hall's session
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
  ) FILTER (WHERE r.id IS NOT NULL)  AS sessions_breakdown

FROM  public.exams           e
LEFT JOIN public.reports     r ON r.exam_id   = e.id
LEFT JOIN public.halls       h ON h.id        = r.hall_id
GROUP BY
  e.id, e.title, e.course_name, e.exam_start, e.exam_end,
  e.status, e.teacher_id, e.created_at;


-- ============================================================
-- SECTION 6 — RLS POLICIES
-- ============================================================

ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;

-- Admin: full access to all exams
DROP POLICY IF EXISTS "exams: admin all" ON public.exams;
CREATE POLICY "exams: admin all" ON public.exams
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Teacher: manage own exams only
DROP POLICY IF EXISTS "exams: teacher manage" ON public.exams;
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

-- TA: read exams they have a session in
DROP POLICY IF EXISTS "exams: ta read assigned" ON public.exams;
CREATE POLICY "exams: ta read assigned" ON public.exams
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE  s.exam_id = exams.id
        AND  s.ta_id   = auth.uid()
    )
  );

-- Recreate sessions teacher policy (consistent wording)
DROP POLICY IF EXISTS "sessions: teacher manage" ON public.sessions;
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
