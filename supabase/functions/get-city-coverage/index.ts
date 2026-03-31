// supabase/functions/get-city-coverage/index.ts
// Returns a coverage quality score for a city: ratio of Tier 1 POIs to total POIs.
// Used by the home screen to show a coverage indicator before tour start.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const url = new URL(req.url);
    const city = url.searchParams.get("city");

    if (!city) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "missing_city", message: "city param required" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Count total active POIs in city
    const { count: totalCount } = await adminClient
      .from("pois")
      .select("*", { count: "exact", head: true })
      .ilike("city", city)
      .in("quality_status", ["active"]);

    // Count Tier 1 POIs
    const { count: tier1Count } = await adminClient
      .from("pois")
      .select("*", { count: "exact", head: true })
      .ilike("city", city)
      .eq("tier", 1)
      .eq("quality_status", "active");

    const total = totalCount ?? 0;
    const tier1 = tier1Count ?? 0;

    // Quality levels:
    //   excellent: ≥80% Tier 1 or ≥100 total POIs with ≥50% Tier 1
    //   good:      ≥40% Tier 1 or ≥30 total POIs
    //   fair:      ≥10 total POIs
    //   sparse:    <10 POIs
    let quality: "excellent" | "good" | "fair" | "sparse";
    const tier1Ratio = total > 0 ? tier1 / total : 0;

    if (total >= 100 && tier1Ratio >= 0.5) quality = "excellent";
    else if (total >= 30 && tier1Ratio >= 0.4) quality = "good";
    else if (total >= 10) quality = "fair";
    else quality = "sparse";

    return new Response(
      JSON.stringify({
        success: true,
        data: { city, total_pois: total, tier1_pois: tier1, tier1_ratio: tier1Ratio, quality },
        meta: { request_id: crypto.randomUUID(), timestamp: new Date().toISOString() },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: { code: "server_error", message: err.message } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
