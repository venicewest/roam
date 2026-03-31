// supabase/functions/end-tour-session/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_DURATION_MINUTES = 2;

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

    const { session_id, route_polyline, total_distance_meters } = await req.json();

    // Fetch session — verify ownership
    const { data: session, error: sessionError } = await adminClient
      .from("tour_sessions")
      .select("*")
      .eq("id", session_id)
      .eq("host_user_id", user.id)
      .eq("status", "active")
      .single();

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "not_found", message: "Session not found" } }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = new Date();
    const startedAt = new Date(session.started_at);
    const durationMinutes = (now.getTime() - startedAt.getTime()) / 60_000;

    let charged = false;
    let creditsUsed = 0;

    if (durationMinutes >= MIN_DURATION_MINUTES) {
      creditsUsed = Math.ceil(durationMinutes / (3 * 60)); // 1 credit per 3 hours
      creditsUsed = Math.max(1, creditsUsed);

      try {
        await adminClient.rpc("deduct_credits", {
          p_user_id: user.id,
          p_amount: creditsUsed,
          p_tour_session_id: session_id,
        });
        charged = true;
      } catch (_err) {
        // Insufficient credits — end session without charge
        creditsUsed = 0;
      }
    }

    await adminClient
      .from("tour_sessions")
      .update({
        status: "completed",
        billing_status: charged ? "charged" : "open",
        credits_charged: creditsUsed,
        ended_at: now.toISOString(),
        route_polyline: route_polyline ?? null,
        total_distance_meters: total_distance_meters ?? null,
      })
      .eq("id", session_id);

    // Broadcast SESSION_STATE ended to all guests listening on the Realtime channel
    if (session.is_group_tour && session.join_code) {
      await adminClient
        .channel(`tour:${session.join_code}`)
        .send({
          type: "broadcast",
          event: "SESSION_STATE",
          payload: { status: "ended", city: session.city },
        });
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: { charged, credits_used: creditsUsed },
        meta: { request_id: crypto.randomUUID(), timestamp: now.toISOString() },
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
