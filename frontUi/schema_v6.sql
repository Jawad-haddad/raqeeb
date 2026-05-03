-- ============================================================
-- Raqeeb Schema v6 — Duplicate exam prevention
-- Run in Supabase SQL Editor AFTER schema_v5.sql
-- ============================================================

-- Prevent a teacher from creating two exams with the same title
-- at the same time window. The composite key is intentionally
-- (teacher_id + title + exam_start + exam_end) so that:
--   • "OOP Midterm" at 9:00-11:00 on two different dates is allowed
--   • Resubmitting the exact same form twice is blocked
ALTER TABLE public.exams
  DROP CONSTRAINT IF EXISTS exams_unique_per_teacher;

ALTER TABLE public.exams
  ADD CONSTRAINT exams_unique_per_teacher
  UNIQUE (teacher_id, title, exam_start, exam_end);
