-- Cron job: process-city-import-queue (every 10 minutes)
-- Calls the edge function to import POIs for the next batch of cities.
--
-- BEFORE RUNNING: replace YOUR_SERVICE_ROLE_KEY below with the actual key.
-- Find it in: Supabase Dashboard → Settings → API → service_role (secret)

SELECT cron.schedule(
  'process-city-import-queue',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://rqgtiuomhgshewvaoeak.supabase.co/functions/v1/process-city-import-queue',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxZ3RpdW9taGdzaGV3dmFvZWFrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzE2NjY1OSwiZXhwIjoyMDg4NzQyNjU5fQ.niQB8JkMDKNS7pp5bu1-EEv8X5-DGF5lz-eGUjS4n74'
    ),
    body    := '{}'::jsonb
  );
  $$
);
