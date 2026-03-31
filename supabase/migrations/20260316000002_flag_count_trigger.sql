-- supabase/migrations/20260316000002_flag_count_trigger.sql
-- Database trigger to keep pois.flag_count in sync with poi_flags inserts/deletes.
-- This replaces the broken application-level increment in rate-poi edge function.

CREATE OR REPLACE FUNCTION increment_poi_flag_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE pois
  SET flag_count = flag_count + 1, updated_at = now()
  WHERE id = NEW.poi_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_increment_poi_flag_count
AFTER INSERT ON poi_flags
FOR EACH ROW
EXECUTE FUNCTION increment_poi_flag_count();

-- Also expose as a callable RPC for explicit use
CREATE OR REPLACE FUNCTION increment_poi_flag_count_rpc(p_poi_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE pois SET flag_count = flag_count + 1, updated_at = now() WHERE id = p_poi_id;
END;
$$;
