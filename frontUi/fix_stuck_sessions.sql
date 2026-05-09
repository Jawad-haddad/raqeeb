-- ============================================================
-- Raqeeb — Fix stuck active sessions
-- Run this ONCE in Supabase SQL Editor to unblock hall NB66
-- (and any other halls that have orphaned 'active' sessions)
-- ============================================================

-- Show what will be affected before running the UPDATE:
SELECT
  s.id,
  s.status,
  s.course_name,
  s.exam_start,
  s.exam_end,
  s.actual_started_at,
  h.name   AS hall_name,
  h.hall_code
FROM   public.sessions s
LEFT JOIN public.halls h ON h.id = s.hall_id
WHERE  s.status = 'active';

-- End ALL stuck active sessions.
-- Safe to run: it only affects sessions currently stuck in 'active'.
-- Sessions that are genuinely running right now will be re-started
-- by the TA pressing "Start Session" again.
UPDATE public.sessions
SET
  status          = 'ended',
  actual_ended_at = now()
WHERE status = 'active';

-- Confirm the result:
SELECT id, status, course_name, actual_ended_at
FROM   public.sessions
WHERE  actual_ended_at >= now() - interval '1 minute'
ORDER BY actual_ended_at DESC;
