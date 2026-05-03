-- ============================================================
-- Raqeeb — Trigger fix
-- Run in Supabase SQL Editor after schema_v5.sql
-- ============================================================
-- Problem with schema_v5 trigger:
--   It only ran when NEW.hall_code IS NOT NULL.
--   ESP devices not yet sending hall_code got no session_id assigned,
--   causing all detections to appear unlinked.
--
-- Fix: restore Strategy C (any-active-session fallback from v3)
--   so existing ESP firmware keeps working while hall_code routing
--   is gradually rolled out.
-- ============================================================

CREATE OR REPLACE FUNCTION public.stamp_detection_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.session_id IS NULL THEN

    -- Strategy A: hall_code + exam time window (new ESP firmware)
    IF NEW.hall_code IS NOT NULL THEN
      SELECT s.id INTO NEW.session_id
      FROM   public.sessions s
      JOIN   public.exams    e ON e.id = s.exam_id
      WHERE  s.status    = 'active'
        AND  s.hall_code = NEW.hall_code
        AND  COALESCE(NEW.created_at, now())
               BETWEEN e.exam_start AND e.exam_end
      ORDER BY s.actual_started_at DESC
      LIMIT 1;

      -- Strategy A2: hall_code match without exam_id (legacy session)
      IF NEW.session_id IS NULL THEN
        SELECT id INTO NEW.session_id
        FROM   public.sessions
        WHERE  status    = 'active'
          AND  hall_code = NEW.hall_code
          AND  exam_id   IS NULL
        ORDER BY actual_started_at DESC
        LIMIT 1;
      END IF;
    END IF;

    -- Strategy B: anchor_id fallback (old ESP firmware / no hall_code set)
    -- When a hall has no anchor_ids configured the condition is always TRUE,
    -- so any active session will match — preserving the original v3 behaviour.
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
