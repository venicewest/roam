import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function generateJoinCode(): string {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("Function called");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Create admin client for DB operations
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Create user client to verify auth — pass the request headers directly
    const userToken =
      req.headers.get("x-user-token") ??
      req.headers.get("Authorization")?.replace("Bearer ", "") ??
      "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: `Bearer ${userToken}` },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    console.log("Auth result - user:", user?.id, "error:", authError?.message);

    if (authError || !user) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "unauthorized",
            message: authError?.message ?? "Invalid token",
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const body = await req.json();
    console.log("Request body:", JSON.stringify(body));
    const { interest_category_ids, city, is_group_tour, depth_tier = 'full' } = body;
    const VALID_TIERS = ['quick', 'full', 'expert'] as const;
    const depthTier = (VALID_TIERS as readonly string[]).includes(depth_tier) ? depth_tier : 'full';

    // Check credit balance using admin client
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("credit_balance")
      .eq("id", user.id)
      .single();

    console.log(
      "Profile:",
      JSON.stringify(profile),
      "Error:",
      profileError?.message,
    );

    if (!profile || profile.credit_balance < 1) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "insufficient_credits",
            message: "Not enough credits to start a tour",
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const join_code = is_group_tour ? generateJoinCode() : null;

    const { data: session, error: sessionError } = await adminClient
      .from("tour_sessions")
      .insert({
        host_user_id: user.id,
        join_code,
        is_group_tour: is_group_tour ?? false,
        depth_tier: depthTier,
        interest_category_ids,
        city: city ?? "Unknown",
        billing_status: "open",
        status: "active",
        last_heartbeat: new Date().toISOString(),
      })
      .select()
      .single();

    console.log("Session created:", !!session, "Error:", sessionError?.message);

    if (sessionError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "session_error", message: sessionError.message },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: { session_id: session.id, join_code },
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
    console.log("Caught error:", err.message);
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
