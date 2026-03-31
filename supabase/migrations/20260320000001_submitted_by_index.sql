-- Migration: index to support efficient rate-limit COUNT queries on pois.submitted_by
-- Used by submit-poi edge function: COUNT WHERE submitted_by=$uid AND created_at > NOW()-24h

CREATE INDEX IF NOT EXISTS pois_submitted_by_created_at_idx
  ON public.pois (submitted_by, created_at DESC)
  WHERE submitted_by IS NOT NULL;
