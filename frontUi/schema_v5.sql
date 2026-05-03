-- ============================================================
-- Raqeeb Schema v5
-- Run in Supabase SQL Editor AFTER schema_v4.sql
-- ============================================================

-- ============================================================
-- SECTION 1 — TABLES
-- ============================================================

-- 1.1  Add hall_code directly to sessions
--      The trigger can now match sessions by hall_code without
--      joining the halls table — simpler and faster.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS hall_code text;

-- Back-fill from the linked hall for any existing sessions
UPDATE public.sessions s
SET    hall_code = h.hall_code
FROM   public.halls h
WHERE  h.id       = s.hall_id
  AND  s.hall_code IS NULL
  AND  h.hall_code IS NOT NULL;

-- 1.2  Remove note and status from espData
--      Comments table handles notes; status tracking is removed.
ALTER TABLE public."espData" DROP COLUMN IF EXISTS note;
ALTER TABLE public."espData" DROP COLUMN IF EXISTS status;

-- ============================================================
-- SECTION 2 — INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_sessions_hall_code
  ON public.sessions (hall_code)
  WHERE hall_code IS NOT NULL;

-- ============================================================
-- SECTION 3 — TRIGGER (simplified)
-- ============================================================

-- Now that sessions carry hall_code directly, the trigger no
-- longer needs to join the halls table.
-- Routing priority:
--   A. hall_code present + exam_id present → time-window check
--   B. hall_code present + no exam_id       → legacy session fallback
CREATE OR REPLACE FUNCTION public.stamp_detection_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.session_id IS NULL AND NEW.hall_code IS NOT NULL THEN

    -- A. Primary: exam-linked session within its time window
    SELECT s.id INTO NEW.session_id
    FROM   public.sessions s
    JOIN   public.exams    e ON e.id = s.exam_id
    WHERE  s.status    = 'active'
      AND  s.hall_code = NEW.hall_code
      AND  COALESCE(NEW.created_at, now())
             BETWEEN e.exam_start AND e.exam_end
    ORDER BY s.actual_started_at DESC
    LIMIT 1;

    -- B. Fallback: legacy session without exam_id
    IF NEW.session_id IS NULL THEN
      SELECT id INTO NEW.session_id
      FROM   public.sessions
      WHERE  status    = 'active'
        AND  hall_code = NEW.hall_code
        AND  exam_id IS NULL
      ORDER BY actual_started_at DESC
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
