// constants/config.ts
// Central configuration — all tuneable values live here

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Geofencing & scan loop
export const SCAN_INTERVAL_MS = 5000; // how often the scan loop fires
export const TILE_RADIUS_METERS = 800; // POI pre-fetch radius
export const TILE_REFRESH_THRESHOLD_METERS = 300; // refresh tile when this close to edge
export const MIN_TRIGGER_METERS = 20; // closest a POI can trigger
export const MAX_TRIGGER_METERS = 80; // furthest a POI can trigger
export const PRE_SYNTHESIS_RADIUS_METERS = 200; // fire synthesize-poi for Tier 3 POIs within this range
export const NARRATION_BUFFER_SECONDS = 8; // pre-fetch lead time
export const AVG_NARRATION_SECONDS = 20; // assumed narration length for distance calc
export const STATIONARY_SPEED_MS = 0.3; // m/s below which user is considered stopped
export const STATIONARY_COOLDOWN_SECONDS = 45; // seconds before resuming scan when stopped
export const MIN_GAP_BETWEEN_NARRATIONS_MS = 12000; // minimum silence between POIs
export const MAX_QUEUE_DEPTH = 5; // max POIs in narration queue
export const MAX_NARRATIONS_PER_2_MIN = 3; // rate cap on narration density
export const GPS_ACCURACY_THRESHOLD_METERS = 25; // ignore fixes worse than this
export const ROLLING_SPEED_WINDOW_SECONDS = 15; // window for speed averaging

// Tour sessions
export const MIN_TOUR_DURATION_FOR_CHARGE_MINUTES = 2; // don't charge under this
export const CREDITS_PER_TOUR_HOURS = 3; // 1 credit per this many hours
export const ABANDONED_SESSION_TIMEOUT_MINUTES = 20;

// Group tours
export const JOIN_BASE_URL = process.env.EXPO_PUBLIC_JOIN_BASE_URL ?? "https://roam.app";
export const MAX_GUESTS_PER_TOUR = 20;
export const EVENT_LOG_TTL_MINUTES = 2;
export const RECONNECT_CATCHUP_WINDOW_SECONDS = 30;

// Content
export const POI_TILE_LIMIT = 50; // max POIs returned per tile fetch
export const ACCESS_COUNT_FLUSH_INTERVAL_MS = 60000; // batch write interval
export const TIER1_PROMOTION_ACCESS_THRESHOLD = 50;
export const TIER1_PROMOTION_RATING_THRESHOLD = 3.5;
export const AUTO_SUPPRESS_FLAG_THRESHOLD = 5;
export const AUTO_SUPPRESS_RATING_THRESHOLD = 2.0;
export const AUTO_SUPPRESS_RATING_MIN_COUNT = 20;

// Credits
export const SIGNUP_BONUS_CREDITS = 3;

// Audio
export const DEFAULT_GAP_BETWEEN_NARRATIONS_SECONDS = 12;
export const MIN_GAP_SECONDS = 8;
export const MAX_GAP_SECONDS = 30;
