-- supabase/migrations/20260316000003_rls_fixes.sql
-- RLS policies missing from the initial schema.

-- Allow hosts to update their own active session (heartbeat, route, etc.)
DROP POLICY IF EXISTS "sessions_update_own" ON public.tour_sessions;
CREATE POLICY "sessions_update_own" ON public.tour_sessions
  FOR UPDATE USING (auth.uid() = host_user_id)
  WITH CHECK (auth.uid() = host_user_id);

-- Allow users to insert their own tour sessions (start-tour-session EF uses service role,
-- but direct client inserts need this for future use)
DROP POLICY IF EXISTS "sessions_insert_own" ON public.tour_sessions;
CREATE POLICY "sessions_insert_own" ON public.tour_sessions
  FOR INSERT WITH CHECK (auth.uid() = host_user_id);

-- Allow updating own profile (display_name, avatar_url)
-- (already exists as profiles_update_own but adding for completeness)
-- No-op if it already exists.

-- Allow users to insert their own interest preferences
-- (already covered but ensure it exists)
DROP POLICY IF EXISTS "prefs_update_own" ON public.user_interest_preferences;
CREATE POLICY "prefs_update_own" ON public.user_interest_preferences
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
