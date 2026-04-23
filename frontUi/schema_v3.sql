-- ============================================================
-- Raqeeb Schema v3
-- Run in Supabase SQL Editor AFTER schema_updates.sql + schema_v2.sql
-- ============================================================

-- ============================================================
-- 1. Add anchor_ids to halls (maps which anchors belong to each hall)
--    Allows the trigger to route detections to the correct session
-- ============================================================
ALTER TABLE public.halls
  ADD COLUMN IF NOT EXISTS anchor_ids text[];

-- ============================================================
-- 2. Prevent two ACTIVE sessions in the same hall simultaneously
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_session_per_hall
  ON public.sessions (hall_id)
  WHERE status = 'active';

-- ============================================================
-- 3. Updated trigger: routes espData rows to the correct session
--    using anchor_id → hall → active session matching.
--    Falls back to any active session when anchor_ids not configured.
-- ============================================================
CREATE OR REPLACE FUNCTION public.stamp_detection_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.session_id IS NULL THEN
    SELECT s.id INTO NEW.session_id
    FROM public.sessions s
    JOIN public.halls h ON h.id = s.hall_id
    WHERE s.status = 'active'
      AND (
        -- No anchors configured for the hall → match any active session
        h.anchor_ids IS NULL
        OR array_length(h.anchor_ids, 1) IS NULL
        -- Anchors configured → only match if this anchor belongs to the hall
        OR NEW.anchor_id = ANY(h.anchor_ids)
      )
    ORDER BY s.actual_started_at DESC
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
