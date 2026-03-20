-- Add preferred ElevenLabs voice to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_voice_id TEXT;
