-- Track AI synthesis attempts per POI (retry limit + deduplication).
-- Separate from poi_synthesis_candidates which stores raw external data.

CREATE TABLE IF NOT EXISTS public.poi_synthesis_attempts (
  poi_id            UUID PRIMARY KEY REFERENCES public.pois(id) ON DELETE CASCADE,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  succeeded_at      TIMESTAMPTZ
);
