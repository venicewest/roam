import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Parse query params
    const url = new URL(req.url);
    const lat = parseFloat(url.searchParams.get("lat") ?? "0");
    const lon = parseFloat(url.searchParams.get("lon") ?? "0");
    const radius = Math.min(
      parseInt(url.searchParams.get("radius_meters") ?? "800"),
      1200,
    );
    const categoryIds =
      url.searchParams
        .get("category_ids")
        ?.split(",")
        .map(Number)
        .filter((n) => !isNaN(n)) ?? [];
    const sessionId = url.searchParams.get("session_id");

    console.log(
      `Tile request: lat=${lat} lon=${lon} radius=${radius} categories=${categoryIds}`,
    );

    if (!lat || !lon) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "invalid_params",
            message: "lat and lon are required",
          },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Fetch completed POI IDs for this session to exclude them
    let excludeIds: string[] = [];
    if (sessionId) {
      const { data: completed } = await adminClient
        .from("tour_session_pois")
        .select("poi_id")
        .eq("session_id", sessionId);
      excludeIds = completed?.map((r) => r.poi_id) ?? [];
    }

    // Call the spatial query function
    const { data: pois, error } = await adminClient.rpc("get_pois_in_radius", {
      p_lat: lat,
      p_lon: lon,
      p_radius_meters: radius,
      p_category_ids: categoryIds.length > 0 ? categoryIds : [1, 2, 3, 4, 5, 6, 7, 8],
      p_exclude_ids: excludeIds.length > 0 ? excludeIds : [],
      p_quality_statuses: ["active"],
    });

    console.log(`Found ${pois?.length ?? 0} POIs, error: ${error?.message}`);

    if (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "query_error", message: error.message },
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const poisList = pois ?? [];

    // AI Flywheel: fire-and-forget synthesis for Tier 3 POIs (no narrative yet).
    // We only trigger up to 3 per tile fetch to avoid thundering herd.
    const tier3Ids: string[] = poisList
      .filter((p: any) => p.tier === 3)
      .slice(0, 3)
      .map((p: any) => p.id);

    if (tier3Ids.length > 0) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const authHeader = req.headers.get("Authorization") ?? "";

      // Fire without await — synthesis is best-effort and has its own 8s timeout
      Promise.all(
        tier3Ids.map((id) =>
          fetch(`${supabaseUrl}/functions/v1/synthesize-poi`, {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
              apikey: serviceRoleKey,
            },
            body: JSON.stringify({ poi_id: id }),
          }).catch(() => {}),
        ),
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          pois: poisList,
          fetched_at: new Date().toISOString(),
        },
        meta: {
          request_id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.log("Error:", err.message);
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "server_error", message: err.message },
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
