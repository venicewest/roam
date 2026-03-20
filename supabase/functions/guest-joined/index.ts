// supabase/functions/guest-joined/index.ts
// Called by the guest page after audio unlock. Increments guest_count and
// broadcasts GUEST_JOINED to the tour Realtime channel.
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

    const code = join_code.toUpperCase().trim();

    // Fetch session and increment guest_count atomically
    const { data: session } = await adminClient
      .from("tour_sessions")
      .select("id, guest_count, status, is_group_tour")
      .eq("join_code", code)
      .eq("is_group_tour", true)
      .eq("status", "active")
      .single();

    if (!session) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "invalid_code", message: "Tour not found or no longer active" } }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const newGuestCount = session.guest_count + 1;

    await adminClient
      .from("tour_sessions")
      .update({ guest_count: newGuestCount })
      .eq("id", session.id);

    // Broadcast GUEST_JOINED to the Realtime channel so host badge updates live
    await adminClient
      .channel(`tour:${code}`)
      .send({
        type: "broadcast",
        event: "GUEST_JOINED",
        payload: { guest_count: newGuestCount },
      });

    return new Response(
      JSON.stringify({
        success: true,
        data: { guest_count: newGuestCount },
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
