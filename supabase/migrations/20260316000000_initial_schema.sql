-- ============================================================
-- Roam — Initial Schema Migration
-- Run in: Supabase SQL Editor
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── Tables ──────────────────────────────────────────────────

-- profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id                         UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  display_name               TEXT,
  avatar_url                 TEXT,
  credit_balance             INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id         TEXT UNIQUE,
  lifetime_credits_purchased INTEGER NOT NULL DEFAULT 0,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- interest_categories
CREATE TABLE IF NOT EXISTS public.interest_categories (
  id        SERIAL PRIMARY KEY,
  slug      TEXT UNIQUE NOT NULL,
  label     TEXT NOT NULL,
  icon_name TEXT
);

-- user_interest_preferences
CREATE TABLE IF NOT EXISTS public.user_interest_preferences (
  user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES public.interest_categories(id),
  PRIMARY KEY (user_id, category_id)
);

-- pois (PostGIS)
CREATE TABLE IF NOT EXISTS public.pois (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                 TEXT,
  address              TEXT,
  city                 TEXT NOT NULL,
  country_code         CHAR(2) NOT NULL,
  location             GEOGRAPHY(Point, 4326) NOT NULL,
  tier                 INTEGER NOT NULL DEFAULT 2 CHECK (tier IN (1, 2, 3)),
  category_id          INTEGER REFERENCES public.interest_categories(id),
  narrative            TEXT NOT NULL,
  source_attribution   TEXT,
  confidence_score     NUMERIC(3,2) CHECK (confidence_score BETWEEN 0 AND 1),
  ai_generated_at      TIMESTAMPTZ,
  access_count         INTEGER NOT NULL DEFAULT 0,
  promoted_to_tier1_at TIMESTAMPTZ,
  rating_count         INTEGER NOT NULL DEFAULT 0,
  rating_sum           INTEGER NOT NULL DEFAULT 0,
  rating_average       NUMERIC(3,2) GENERATED ALWAYS AS (
    CASE WHEN rating_count = 0 THEN NULL
         ELSE ROUND(rating_sum::NUMERIC / rating_count, 2) END
  ) STORED,
  flag_count           INTEGER NOT NULL DEFAULT 0,
  quality_status       TEXT NOT NULL DEFAULT 'active'
                         CHECK (quality_status IN ('active','under_review','suppressed','removed')),
  is_public            BOOLEAN NOT NULL DEFAULT TRUE,
  submitted_by         UUID REFERENCES public.profiles(id),
  moderation_status    TEXT DEFAULT 'approved'
                         CHECK (moderation_status IN ('pending','approved','rejected')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pois_location_idx ON public.pois USING GIST(location);
CREATE INDEX IF NOT EXISTS pois_city_category_idx ON public.pois(city, category_id);
CREATE INDEX IF NOT EXISTS pois_access_count_idx ON public.pois(access_count DESC) WHERE tier = 2;
CREATE INDEX IF NOT EXISTS pois_quality_status_idx ON public.pois(quality_status) WHERE quality_status != 'active';

-- poi_audio_cache
CREATE TABLE IF NOT EXISTS public.poi_audio_cache (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poi_id           UUID REFERENCES public.pois(id) ON DELETE CASCADE,
  voice_provider   TEXT NOT NULL CHECK (voice_provider IN ('google', 'elevenlabs')),
  voice_id         TEXT NOT NULL,
  storage_path     TEXT NOT NULL,
  duration_seconds NUMERIC(6,2),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(poi_id, voice_provider, voice_id)
);

-- poi_synthesis_candidates
CREATE TABLE IF NOT EXISTS public.poi_synthesis_candidates (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address                 TEXT,
  city                    TEXT NOT NULL,
  location                GEOGRAPHY(Point, 4326) NOT NULL,
  raw_metadata            JSONB NOT NULL,
  source                  TEXT NOT NULL,
  synthesis_attempted_at  TIMESTAMPTZ,
  synthesis_succeeded     BOOLEAN,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS poi_synthesis_candidates_location_idx
  ON public.poi_synthesis_candidates USING GIST(location);
CREATE INDEX IF NOT EXISTS poi_synthesis_candidates_unsynthesized_idx
  ON public.poi_synthesis_candidates(city) WHERE synthesis_attempted_at IS NULL;

-- tour_sessions
CREATE TABLE IF NOT EXISTS public.tour_sessions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  host_user_id            UUID REFERENCES public.profiles(id) NOT NULL,
  join_code               CHAR(6) UNIQUE,
  is_group_tour           BOOLEAN NOT NULL DEFAULT FALSE,
  guest_count             INTEGER NOT NULL DEFAULT 0,
  interest_category_ids   INTEGER[] NOT NULL,
  city                    TEXT NOT NULL,
  credits_charged         INTEGER NOT NULL DEFAULT 0,
  billing_status          TEXT NOT NULL DEFAULT 'open'
                            CHECK (billing_status IN ('open','charged','refunded')),
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','completed','abandoned')),
  started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at                TIMESTAMPTZ,
  last_heartbeat          TIMESTAMPTZ DEFAULT NOW(),
  route_polyline          TEXT,
  total_distance_meters   INTEGER
);

-- tour_session_pois
CREATE TABLE IF NOT EXISTS public.tour_session_pois (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id              UUID REFERENCES public.tour_sessions(id) ON DELETE CASCADE,
  poi_id                  UUID REFERENCES public.pois(id),
  narrated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_distance_meters INTEGER,
  was_ai_generated        BOOLEAN NOT NULL DEFAULT FALSE,
  audio_duration_seconds  NUMERIC(6,2),
  rating                  SMALLINT CHECK (rating BETWEEN 1 AND 5),
  rating_submitted_at     TIMESTAMPTZ,
  user_flag               TEXT CHECK (user_flag IN (
    'inaccurate','offensive','boring','too_long','wrong_location'
  ))
);

CREATE INDEX IF NOT EXISTS tour_session_pois_session_idx
  ON public.tour_session_pois(session_id);

-- credit_packages
CREATE TABLE IF NOT EXISTS public.credit_packages (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  credit_amount   INTEGER NOT NULL,
  price_cents     INTEGER NOT NULL,
  stripe_price_id TEXT NOT NULL UNIQUE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
  display_order   INTEGER NOT NULL DEFAULT 0
);

-- Seed default packages
INSERT INTO public.credit_packages (name, credit_amount, price_cents, stripe_price_id, is_featured, display_order)
VALUES
  ('Starter',  5,  499,  'price_starter_placeholder',  FALSE, 1),
  ('Explorer', 15, 1199, 'price_explorer_placeholder', TRUE,  2),
  ('Roamer',   40, 2499, 'price_roamer_placeholder',   FALSE, 3)
ON CONFLICT (stripe_price_id) DO NOTHING;

-- credit_transactions
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                   UUID REFERENCES public.profiles(id) NOT NULL,
  amount                    INTEGER NOT NULL,
  balance_after             INTEGER NOT NULL,
  transaction_type          TEXT NOT NULL CHECK (transaction_type IN (
    'purchase','tour_charge','refund','promo','admin_adjust'
  )),
  tour_session_id           UUID REFERENCES public.tour_sessions(id),
  stripe_payment_intent_id  TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- poi_flags
CREATE TABLE IF NOT EXISTS public.poi_flags (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poi_id         UUID REFERENCES public.pois(id) ON DELETE CASCADE,
  session_poi_id UUID REFERENCES public.tour_session_pois(id),
  user_id        UUID REFERENCES public.profiles(id),
  flag_reason    TEXT NOT NULL CHECK (flag_reason IN (
    'inaccurate','offensive','boring','too_long','wrong_location'
  )),
  user_note      TEXT,
  resolved       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- tour_events_log (Realtime event buffer, 2-min TTL)
CREATE TABLE IF NOT EXISTS public.tour_events_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID REFERENCES public.tour_sessions(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tour_events_log_cleanup_idx ON public.tour_events_log(created_at);
CREATE INDEX IF NOT EXISTS tour_events_log_session_idx ON public.tour_events_log(session_id, created_at);

-- ─── Seed Interest Categories ─────────────────────────────────

INSERT INTO public.interest_categories (slug, label, icon_name) VALUES
  ('historical',    'Historical',    'landmark'),
  ('financial',     'Financial',     'dollar-sign'),
  ('real_estate',   'Real Estate',   'home'),
  ('architectural', 'Architectural', 'building'),
  ('cultural',      'Cultural',      'palette'),
  ('culinary',      'Culinary',      'utensils'),
  ('nature',        'Nature',        'leaf'),
  ('religious',     'Religious',     'church')
ON CONFLICT (slug) DO NOTHING;

-- ─── Row Level Security ───────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interest_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_interest_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tour_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tour_session_pois ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poi_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pois ENABLE ROW LEVEL SECURITY;

-- profiles: own row only
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- interest_categories: public read
DROP POLICY IF EXISTS "categories_select_all" ON public.interest_categories;
CREATE POLICY "categories_select_all" ON public.interest_categories
  FOR SELECT USING (true);

-- user_interest_preferences: own rows
DROP POLICY IF EXISTS "prefs_select_own" ON public.user_interest_preferences;
CREATE POLICY "prefs_select_own" ON public.user_interest_preferences
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "prefs_insert_own" ON public.user_interest_preferences;
CREATE POLICY "prefs_insert_own" ON public.user_interest_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "prefs_delete_own" ON public.user_interest_preferences;
CREATE POLICY "prefs_delete_own" ON public.user_interest_preferences
  FOR DELETE USING (auth.uid() = user_id);

-- pois: public read for active pois
DROP POLICY IF EXISTS "pois_select_active" ON public.pois;
CREATE POLICY "pois_select_active" ON public.pois
  FOR SELECT USING (quality_status = 'active' AND is_public = true);

-- tour_sessions: own sessions
DROP POLICY IF EXISTS "sessions_select_own" ON public.tour_sessions;
CREATE POLICY "sessions_select_own" ON public.tour_sessions
  FOR SELECT USING (auth.uid() = host_user_id);

-- tour_session_pois: via session ownership
DROP POLICY IF EXISTS "session_pois_select_own" ON public.tour_session_pois;
CREATE POLICY "session_pois_select_own" ON public.tour_session_pois
  FOR SELECT USING (
    session_id IN (
      SELECT id FROM public.tour_sessions WHERE host_user_id = auth.uid()
    )
  );

-- credit_packages: public read active
DROP POLICY IF EXISTS "packages_select_active" ON public.credit_packages;
CREATE POLICY "packages_select_active" ON public.credit_packages
  FOR SELECT USING (is_active = true);

-- credit_transactions: own rows
DROP POLICY IF EXISTS "transactions_select_own" ON public.credit_transactions;
CREATE POLICY "transactions_select_own" ON public.credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- ─── Postgres Functions ───────────────────────────────────────

-- add_credits: atomic credit addition with transaction log
CREATE OR REPLACE FUNCTION public.add_credits(
  p_user_id               UUID,
  p_amount                INTEGER,
  p_transaction_type      TEXT,
  p_tour_session_id       UUID DEFAULT NULL,
  p_stripe_payment_intent TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  UPDATE public.profiles
  SET credit_balance = credit_balance + p_amount,
      lifetime_credits_purchased = CASE
        WHEN p_transaction_type = 'purchase' THEN lifetime_credits_purchased + p_amount
        ELSE lifetime_credits_purchased
      END,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING credit_balance INTO v_new_balance;

  INSERT INTO public.credit_transactions
    (user_id, amount, balance_after, transaction_type, tour_session_id, stripe_payment_intent_id)
  VALUES
    (p_user_id, p_amount, v_new_balance, p_transaction_type, p_tour_session_id, p_stripe_payment_intent);

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- deduct_credits: atomic deduction with row lock
CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_user_id         UUID,
  p_amount          INTEGER,
  p_tour_session_id UUID
) RETURNS INTEGER AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  UPDATE public.profiles
  SET credit_balance = credit_balance - p_amount,
      updated_at = NOW()
  WHERE id = p_user_id AND credit_balance >= p_amount
  RETURNING credit_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  INSERT INTO public.credit_transactions
    (user_id, amount, balance_after, transaction_type, tour_session_id)
  VALUES
    (p_user_id, -p_amount, v_new_balance, 'tour_charge', p_tour_session_id);

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- get_pois_in_radius: spatial POI query
CREATE OR REPLACE FUNCTION public.get_pois_in_radius(
  p_lat             DOUBLE PRECISION,
  p_lon             DOUBLE PRECISION,
  p_radius_meters   INTEGER,
  p_category_ids    INTEGER[],
  p_exclude_ids     UUID[] DEFAULT '{}',
  p_quality_statuses TEXT[] DEFAULT ARRAY['active']
) RETURNS TABLE (
  id               UUID,
  name             TEXT,
  lat              DOUBLE PRECISION,
  lon              DOUBLE PRECISION,
  category_id      INTEGER,
  tier             INTEGER,
  has_audio_cache  BOOLEAN,
  distance_meters  DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    ST_Y(p.location::geometry)::DOUBLE PRECISION AS lat,
    ST_X(p.location::geometry)::DOUBLE PRECISION AS lon,
    p.category_id,
    p.tier,
    EXISTS(SELECT 1 FROM public.poi_audio_cache c WHERE c.poi_id = p.id) AS has_audio_cache,
    ST_Distance(p.location, ST_MakePoint(p_lon, p_lat)::geography) AS distance_meters
  FROM public.pois p
  WHERE
    ST_DWithin(p.location, ST_MakePoint(p_lon, p_lat)::geography, p_radius_meters)
    AND (p_category_ids IS NULL OR array_length(p_category_ids, 1) = 0 OR p.category_id = ANY(p_category_ids))
    AND p.id != ALL(p_exclude_ids)
    AND p.quality_status = ANY(p_quality_statuses)
    AND p.is_public = true
  ORDER BY distance_meters ASC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- record_poi_rating: atomic rating aggregate update
CREATE OR REPLACE FUNCTION public.record_poi_rating(
  p_poi_id UUID,
  p_rating SMALLINT
) RETURNS VOID AS $$
BEGIN
  UPDATE public.pois
  SET rating_count = rating_count + 1,
      rating_sum   = rating_sum + p_rating,
      updated_at   = NOW()
  WHERE id = p_poi_id;

  PERFORM public.check_suppression_threshold(p_poi_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- check_suppression_threshold: auto-suppress on thresholds
CREATE OR REPLACE FUNCTION public.check_suppression_threshold(
  p_poi_id UUID
) RETURNS VOID AS $$
DECLARE
  v_poi public.pois%ROWTYPE;
BEGIN
  SELECT * INTO v_poi FROM public.pois WHERE id = p_poi_id;

  IF v_poi.flag_count >= 5 THEN
    UPDATE public.pois SET quality_status = 'suppressed', updated_at = NOW() WHERE id = p_poi_id;
  ELSIF v_poi.rating_count >= 20 AND (v_poi.rating_sum::NUMERIC / v_poi.rating_count) < 2.0 THEN
    UPDATE public.pois SET quality_status = 'suppressed', updated_at = NOW() WHERE id = p_poi_id;
  ELSIF v_poi.flag_count >= 3 THEN
    UPDATE public.pois SET quality_status = 'under_review', updated_at = NOW() WHERE id = p_poi_id;
  ELSIF v_poi.rating_count >= 10 AND (v_poi.rating_sum::NUMERIC / v_poi.rating_count) < 2.5 THEN
    UPDATE public.pois SET quality_status = 'under_review', updated_at = NOW() WHERE id = p_poi_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- increment_poi_access_count: batched update
CREATE OR REPLACE FUNCTION public.increment_poi_access_count(
  p_poi_id    UUID,
  p_increment INTEGER DEFAULT 1
) RETURNS VOID AS $$
BEGIN
  UPDATE public.pois
  SET access_count = access_count + p_increment,
      updated_at   = NOW()
  WHERE id = p_poi_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Updated_at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER pois_updated_at BEFORE UPDATE ON public.pois
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
