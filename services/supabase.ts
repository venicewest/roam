// services/supabase.ts
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../constants/config";

// SecureStore keys: alphanumeric + . - _ only (no +, /, =, :, etc.)
const sanitizeKey = (key: string) => key.replace(/[^a-zA-Z0-9._-]/g, "_");

const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(sanitizeKey(key)),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(sanitizeKey(key), value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(sanitizeKey(key)),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
});

// ─── Types matching our database schema ───────────────────────────────────────

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  credit_balance: number;
  stripe_customer_id: string | null;
  lifetime_credits_purchased: number;
  preferred_voice_id: string | null;
  created_at: string;
  updated_at: string;
};

export type InterestCategory = {
  id: number;
  slug: string;
  label: string;
  icon_name: string | null;
};

export type Poi = {
  id: string;
  name: string | null;
  address: string | null;
  city: string;
  country_code: string;
  tier: 1 | 2 | 3;
  category_id: number;
  narrative: string;
  source_attribution: string | null;
  confidence_score: number | null;
  access_count: number;
  rating_count: number;
  rating_average: number | null;
  flag_count: number;
  quality_status: "active" | "under_review" | "suppressed" | "removed";
  created_at: string;
};

export type PoiTileItem = {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  category_id: number;
  tier: 1 | 2 | 3;
  has_audio_cache: boolean;
  distance_meters: number;
};

export type TourSession = {
  id: string;
  host_user_id: string;
  join_code: string | null;
  is_group_tour: boolean;
  guest_count: number;
  interest_category_ids: number[];
  city: string;
  credits_charged: number;
  billing_status: "open" | "charged" | "refunded";
  status: "active" | "completed" | "abandoned";
  started_at: string;
  ended_at: string | null;
  route_polyline: string | null;
  total_distance_meters: number | null;
  depth_tier?: 'quick' | 'full' | 'expert';
};

export type TourSessionPoi = {
  id: string;
  session_id: string;
  poi_id: string;
  narrated_at: string;
  trigger_distance_meters: number | null;
  was_ai_generated: boolean;
  audio_duration_seconds: number | null;
  rating: number | null;
  rating_submitted_at: string | null;
  user_flag: string | null;
  pois?: Poi;
};

export type CreditPackage = {
  id: number;
  name: string;
  credit_amount: number;
  price_cents: number;
  stripe_price_id: string;
  is_active: boolean;
  is_featured: boolean;
  display_order: number;
};

export type CreditTransaction = {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  transaction_type:
    | "purchase"
    | "tour_charge"
    | "refund"
    | "promo"
    | "admin_adjust";
  tour_session_id: string | null;
  stripe_payment_intent_id: string | null;
  created_at: string;
};
