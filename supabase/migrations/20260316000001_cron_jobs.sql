-- supabase/migrations/20260316000001_cron_jobs.sql
-- pg_cron scheduled jobs for maintenance and content quality.
-- Requires pg_cron extension enabled in Supabase dashboard under Database > Extensions.

-- ─── Enable pg_cron (idempotent) ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ─── 1. Cleanup abandoned tours (every 15 minutes) ───────────────────────────
-- Sessions where last_heartbeat went stale for >20 min are marked abandoned.
-- No credit deduction — the host simply lost connectivity or closed the app.
SELECT cron.schedule(
  'cleanup-abandoned-tours',
  '*/15 * * * *',
  $$
  UPDATE tour_sessions
  SET status = 'abandoned', ended_at = now()
  WHERE
    status = 'active'
    AND last_heartbeat < now() - INTERVAL '20 minutes';
  $$
);

-- ─── 2. Cleanup event log (every hour) ───────────────────────────────────────
-- tour_events_log is a short-lived streaming table; rows older than 2 minutes
-- are no longer needed (guests reconnecting use the catch-up window).
SELECT cron.schedule(
  'cleanup-event-log',
  '0 * * * *',
  $$
  DELETE FROM tour_events_log
  WHERE created_at < now() - INTERVAL '2 minutes';
  $$
);

-- ─── 3. Promote POI tier (every Sunday at 2am UTC) ───────────────────────────
-- Tier 2 POIs that have proven quality get promoted to Tier 1 (curated).
-- Criteria: ≥50 accesses, ≥3.5 average rating, zero unresolved flags.
SELECT cron.schedule(
  'promote-poi-tier',
  '0 2 * * 0',
  $$
  UPDATE pois
  SET tier = 1, updated_at = now()
  WHERE
    tier = 2
    AND quality_status = 'active'
    AND access_count >= 50
    AND rating_count >= 5
    AND rating_average >= 3.5
    AND flag_count = 0;
  $$
);

-- ─── 4. Suppress low-rated POIs (every Sunday at 2am UTC) ────────────────────
-- Auto-suppress POIs that consistently receive poor feedback.
-- Criteria A: rating <2.0 with ≥20 ratings.
-- Criteria B: 5+ unresolved flags.
SELECT cron.schedule(
  'suppress-low-rated-pois',
  '0 2 * * 0',
  $$
  UPDATE pois
  SET quality_status = 'suppressed', updated_at = now()
  WHERE
    quality_status = 'active'
    AND (
      (rating_average < 2.0 AND rating_count >= 20)
      OR flag_count >= 5
    );
  $$
);

-- ─── Grant cron to postgres role (required by Supabase) ──────────────────────
GRANT USAGE ON SCHEMA cron TO postgres;
