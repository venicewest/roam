// supabase/functions/get-tour-transcript/index.ts
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

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const userToken =
      req.headers.get("x-user-token") ??
      req.headers.get("Authorization")?.replace("Bearer ", "") ??
      "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: `Bearer ${userToken}` },
      },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "unauthorized", message: "Invalid token" } }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = new URL(req.url);
    const session_id = url.searchParams.get("session_id");

    if (!session_id) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "missing_param", message: "session_id required" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch session — verify ownership
    const { data: session } = await adminClient
      .from("tour_sessions")
      .select("*")
      .eq("id", session_id)
      .eq("host_user_id", user.id)
      .single();

    if (!session) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "not_found", message: "Session not found" } }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch stops with full POI narrative
    const { data: stops } = await adminClient
      .from("tour_session_pois")
      .select(`
        id,
        poi_id,
        narrated_at,
        trigger_distance_meters,
        was_ai_generated,
        audio_duration_seconds,
        rating,
        rating_submitted_at,
        user_flag,
        pois (
          id, name, address, narrative, category_id,
          tier, rating_average, rating_count
        )
      `)
      .eq("session_id", session_id)
      .order("narrated_at", { ascending: true });

    return new Response(
      JSON.stringify({
        success: true,
        data: { session, stops: stops ?? [] },
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
