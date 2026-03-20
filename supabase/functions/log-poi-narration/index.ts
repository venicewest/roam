// supabase/functions/log-poi-narration/index.ts
// Batched flush: inserts tour_session_pois rows and increments access counts.
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

    const { session_id, events } = await req.json() as {
      session_id: string;
      events: Array<{
        poi_id: string;
        narrated_at: string;
        trigger_distance_meters: number;
        was_ai_generated: boolean;
        audio_duration_seconds?: number;
      }>;
    };

    if (!events?.length) {
      return new Response(
        JSON.stringify({ success: true, data: { logged: 0 }, meta: { request_id: crypto.randomUUID(), timestamp: new Date().toISOString() } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify session ownership
    const { data: session } = await adminClient
      .from("tour_sessions")
      .select("id")
      .eq("id", session_id)
      .eq("host_user_id", user.id)
      .single();

    if (!session) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "not_found", message: "Session not found" } }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Insert narration rows
    const rows = events.map((e) => ({
      session_id,
      poi_id: e.poi_id,
      narrated_at: e.narrated_at,
      trigger_distance_meters: e.trigger_distance_meters,
      was_ai_generated: e.was_ai_generated,
      audio_duration_seconds: e.audio_duration_seconds ?? null,
    }));

    await adminClient.from("tour_session_pois").insert(rows);

    // Increment access counts (batched)
    const poiCounts = events.reduce<Record<string, number>>((acc, e) => {
      acc[e.poi_id] = (acc[e.poi_id] ?? 0) + 1;
      return acc;
    }, {});

    await Promise.all(
      Object.entries(poiCounts).map(([poiId, count]) =>
        adminClient.rpc("increment_poi_access_count", {
          p_poi_id: poiId,
          p_increment: count,
        }),
      ),
    );

    // Update session heartbeat
    await adminClient
      .from("tour_sessions")
      .update({ last_heartbeat: new Date().toISOString() })
      .eq("id", session_id);

    return new Response(
      JSON.stringify({
        success: true,
        data: { logged: events.length },
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
