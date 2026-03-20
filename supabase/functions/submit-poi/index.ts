// supabase/functions/submit-poi/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth: validate user JWT from x-user-token header
    const userToken =
      req.headers.get("x-user-token") ??
      req.headers.get("Authorization")?.replace("Bearer ", "") ??
      "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "unauthorized", message: "Authentication required" } }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { name, category_id, lat, lng } = await req.json();
    if (!name?.trim() || !category_id || lat == null || lng == null) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "invalid_input", message: "name, category_id, lat, lng are required" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Rate limit: rolling 24h window, max 5 submissions per user
    const { count } = await adminClient
      .from("pois")
      .select("id", { count: "exact", head: true })
      .eq("submitted_by", user.id)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if ((count ?? 0) >= 5) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "rate_limited", message: "Submission limit reached (5 per day)" } }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // City resolution: nearest active POI within 50km
    const { data: nearby } = await adminClient.rpc("get_pois_in_radius", {
      p_lat: lat,
      p_lng: lng,
      p_radius_meters: 50000,
      p_quality_statuses: ["active"],
      p_limit: 1,
    });

    const city: string = nearby?.[0]?.city ?? "";
    const countryCode: string = nearby?.[0]?.country_code ?? "XX";

    // Insert POI as under_review — invisible to scanner until synthesis activates it
    const { data: poi, error: insertError } = await adminClient
      .from("pois")
      .insert({
        name: name.trim(),
        category_id,
        location: `SRID=4326;POINT(${lng} ${lat})`,
        city,
        country_code: countryCode,
        tier: 3,
        submitted_by: user.id,
        narrative: "",         // empty: synthesis-pending sentinel (tier=3 bypasses synthesize-poi skip guard)
        quality_status: "under_review",  // invisible to get-poi-tile until synthesis completes
      })
      .select("id")
      .single();

    if (insertError || !poi) {
      console.error("POI insert error:", insertError);
      return new Response(
        JSON.stringify({ success: false, error: { code: "insert_failed", message: "Failed to save POI" } }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Trigger synthesis: M2M call (service role), fire-and-forget
    // Fallback: synthesize_poi_cron runs every 5min and picks up stranded under_review POIs
    fetch(`${supabaseUrl}/functions/v1/synthesize-poi`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "apikey": serviceRoleKey,
      },
      body: JSON.stringify({ poi_id: poi.id }),
    }).catch(() => {}); // errors are silent; cron is the guaranteed fallback

    return new Response(
      JSON.stringify({
        success: true,
        data: { poi_id: poi.id },
        meta: { request_id: crypto.randomUUID(), timestamp: new Date().toISOString() },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: { code: "server_error", message: (err as Error).message } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
