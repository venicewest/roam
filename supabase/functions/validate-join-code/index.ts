// supabase/functions/validate-join-code/index.ts
// No auth required — guests are not logged in.
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
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { join_code } = await req.json();

    if (!join_code || typeof join_code !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: { code: "invalid_code", message: "Invalid code" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Look up active group tour session by join code
    const { data: session } = await adminClient
      .from("tour_sessions")
      .select("id, city, host_user_id, status, is_group_tour, guest_count")
      .eq("join_code", join_code.toUpperCase().trim())
      .eq("is_group_tour", true)
      .eq("status", "active")
      .single();

    if (!session) {
      // Opaque error — don't reveal whether code was valid or session ended
      return new Response(
        JSON.stringify({ success: false, error: { code: "invalid_code", message: "Tour not found or no longer active" } }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch host display name
    const { data: profile } = await adminClient
      .from("profiles")
      .select("display_name")
      .eq("id", session.host_user_id)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          session_id: session.id,
          city: session.city,
          host_display_name: profile?.display_name ?? "Your guide",
          guest_count: session.guest_count,
        },
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
