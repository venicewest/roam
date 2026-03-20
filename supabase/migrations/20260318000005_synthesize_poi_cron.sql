-- Cron job: synthesize-poi (every 5 minutes)
-- Picks unsynthesized Tier 3 POIs and generates AI narratives + TTS audio.
-- Runs more frequently than city import since it's the core quality flywheel.

SELECT cron.schedule(
  'synthesize-poi',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://rqgtiuomhgshewvaoeak.supabase.co/functions/v1/synthesize-poi',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxZ3RpdW9taGdzaGV3dmFvZWFrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzE2NjY1OSwiZXhwIjoyMDg4NzQyNjU5fQ.niQB8JkMDKNS7pp5bu1-EEv8X5-DGF5lz-eGUjS4n74'
    ),
    body    := '{}'::jsonb
  );
  $$
);
