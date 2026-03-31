-- supabase/migrations/20260319000001_depth_tier.sql
-- Add depth_tier to tour_sessions for narration depth preference.

ALTER TABLE public.tour_sessions
  ADD COLUMN IF NOT EXISTS depth_tier TEXT NOT NULL DEFAULT 'full'
    CHECK (depth_tier IN ('quick', 'full', 'expert'));

COMMENT ON COLUMN public.tour_sessions.depth_tier IS
  'Narration depth selected by the host: quick (~20s), full (~75s), expert (~2.5min)';
