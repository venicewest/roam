// services/api.ts
import { supabase } from "./supabase";

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    request_id: string;
    timestamp: string;
  };
};

const FUNCTIONS_URL =
  "https://rqgtiuomhgshewvaoeak.supabase.co/functions/v1";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxZ3RpdW9taGdzaGV3dmFvZWFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNjY2NTksImV4cCI6MjA4ODc0MjY1OX0.rTLn6sU1-P1DiWS2Wpyhw01wKTkruK41xHBdn-HvOH0";

async function call<T>(
  functionName: string,
  body?: Record<string, unknown>,
  method: "POST" | "GET" = "POST",
): Promise<ApiResponse<T>> {
  try {
    // Force a fresh session refresh to get a valid JWT
    const { data: refreshData } = await supabase.auth.refreshSession();
    const session = refreshData.session;
    const raw = session?.access_token ?? "";
    const parts = raw.split(".");
    const token = parts.length === 3 ? raw : ANON_KEY;

    const res = await fetch(`${FUNCTIONS_URL}/${functionName}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        // Gateway requires HS256 JWT — send anon key to pass gateway validation
        Authorization: `Bearer ${ANON_KEY}`,
        // Pass the user's ES256 token separately for function-level auth
        "x-user-token": token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = (await res.json()) as ApiResponse<T>;
    return (
      data ?? {
        success: false,
        error: { code: "empty_response", message: "No data returned" },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      success: false,
      error: { code: "network_error", message },
    };
  }
}

// ─── Tour Sessions ─────────────────────────────────────────────────────────────

export const api = {
  startTourSession: (body: {
    interest_category_ids: number[];
    city: string;
    is_group_tour: boolean;
  }) =>
    call<{ session_id: string; join_code: string | null }>(
      "start-tour-session",
      body,
    ),

  endTourSession: (body: {
    session_id: string;
    route_polyline?: string;
    total_distance_meters?: number;
  }) =>
    call<{ charged: boolean; credits_used: number }>("end-tour-session", body),

  getPoiTile: (params: {
    lat: number;
    lon: number;
    radius_meters: number;
    category_ids: string;
    session_id: string;
  }) => {
    const query = new URLSearchParams(
      params as unknown as Record<string, string>,
    ).toString();
    return call<{
      pois: import("./supabase").PoiTileItem[];
      fetched_at: string;
    }>(`get-poi-tile?${query}`, undefined, "GET");
  },

  logPoiNarrations: (body: {
    session_id: string;
    events: Array<{
      poi_id: string;
      narrated_at: string;
      trigger_distance_meters: number;
      was_ai_generated: boolean;
    }>;
  }) => call<{ logged: number }>("log-poi-narration", body),

  // ─── Group Tours ──────────────────────────────────────────────────────────

  validateJoinCode: (body: { join_code: string }) =>
    call<{ session_id: string; host_display_name: string; city: string }>(
      "validate-join-code",
      body,
    ),

  guestJoined: (body: { join_code: string }) =>
    call<{ guest_count: number }>("guest-joined", body),

  // ─── Ratings ──────────────────────────────────────────────────────────────

  ratePoi: (body: {
    session_poi_id: string;
    rating?: number;
    flag_reason?: string;
    user_note?: string;
  }) => call<{ success: boolean }>("rate-poi", body),

  getTourTranscript: (session_id: string) =>
    call<{
      session: import("./supabase").TourSession;
      stops: import("./supabase").TourSessionPoi[];
    }>(`get-tour-transcript?session_id=${session_id}`, undefined, "GET"),

  // ─── Billing ──────────────────────────────────────────────────────────────

  createPaymentIntent: (body: { package_id: number }) =>
    call<{ client_secret: string }>("create-payment-intent", body),

  getCreditPackages: () =>
    call<{ packages: import("./supabase").CreditPackage[] }>(
      "get-credit-packages",
      undefined,
      "GET",
    ),

  getBillingHistory: () =>
    call<{ transactions: import("./supabase").CreditTransaction[] }>(
      "get-billing-history",
      undefined,
      "GET",
    ),

  getCityCoverage: (city: string) =>
    call<{
      city: string;
      total_pois: number;
      tier1_pois: number;
      tier1_ratio: number;
      quality: "excellent" | "good" | "fair" | "sparse";
    }>(`get-city-coverage?city=${encodeURIComponent(city)}`, undefined, "GET"),

  synthesizePoi: (body: { poi_id: string; depth_tier?: 'quick' | 'full' | 'expert' }) =>
    call<{ poi_id: string; narrative: string; audio_url: string | null; provider: string }>(
      "synthesize-poi",
      body,
    ),

  getPoiFollowup: (body: { poi_id: string; depth_tier?: 'quick' | 'full' | 'expert' }) =>
    call<{ audio_url: string | null; cached: boolean }>(
      "get-poi-followup",
      body,
    ),
};
