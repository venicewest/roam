// supabase/functions/rate-poi/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_FLAGS = ["inaccurate", "offensive", "boring", "too_long", "wrong_location"];

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

    const { session_poi_id, rating, flag_reason, user_note } = await req.json();

    if (!session_poi_id) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "missing_field", message: "session_poi_id required" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (rating !== undefined && (rating < 1 || rating > 5)) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "invalid_rating", message: "Rating must be 1–5" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (flag_reason && !VALID_FLAGS.includes(flag_reason)) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "invalid_flag", message: "Invalid flag reason" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Get tour_session_poi + verify ownership
    const { data: sessionPoi } = await adminClient
      .from("tour_session_pois")
      .select("id, poi_id, session_id, tour_sessions(host_user_id)")
      .eq("id", session_poi_id)
      .single() as any;

    if (!sessionPoi || sessionPoi.tour_sessions?.host_user_id !== user.id) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "not_found", message: "Stop not found" } }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = new Date().toISOString();

    // Update tour_session_pois
    const updates: Record<string, unknown> = {};
    if (rating !== undefined) {
      updates.rating = rating;
      updates.rating_submitted_at = now;
    }
    if (flag_reason) {
      updates.user_flag = flag_reason;
    }

    if (Object.keys(updates).length > 0) {
      await adminClient.from("tour_session_pois").update(updates).eq("id", session_poi_id);
    }

    // Update POI aggregate rating
    if (rating !== undefined && sessionPoi.poi_id) {
      await adminClient.rpc("record_poi_rating", {
        p_poi_id: sessionPoi.poi_id,
        p_rating: rating,
      });
    }

    // Create poi_flags row if flagging
    if (flag_reason && sessionPoi.poi_id) {
      await adminClient.from("poi_flags").insert({
        poi_id: sessionPoi.poi_id,
        session_poi_id,
        user_id: user.id,
        flag_reason,
        user_note: user_note ?? null,
      });

      // flag_count is incremented by the trg_increment_poi_flag_count DB trigger on INSERT.
      // Run suppression check after the flag row is committed.
      await adminClient.rpc("check_suppression_threshold", { p_poi_id: sessionPoi.poi_id });
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: { success: true },
        meta: { request_id: crypto.randomUUID(), timestamp: now },
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
