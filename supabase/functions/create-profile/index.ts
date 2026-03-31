// supabase/functions/create-profile/index.ts
// Triggered by DB webhook on auth.users INSERT
// Creates the profile row and awards 3 promo credits.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SIGNUP_BONUS_CREDITS = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // No auth check — this function is only callable from the DB webhook
    // which runs server-side inside the Supabase network.

    const payload = await req.json();
    // DB webhook sends: { type: "INSERT", table: "users", record: { id, email, ... } }
    const user = payload.record ?? payload;
    const userId: string = user.id;
    const displayName: string | null =
      user.raw_user_meta_data?.display_name ??
      user.raw_user_meta_data?.full_name ??
      null;

    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing user id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Create profile row (upsert so re-delivery is safe)
    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert({ id: userId, display_name: displayName }, { onConflict: "id" });

    if (profileError) {
      console.error("Profile insert error:", profileError.message);
      return new Response(
        JSON.stringify({ success: false, error: profileError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Award promo credits — idempotent: only if no promo transaction exists yet
    const { data: existingPromo } = await adminClient
      .from("credit_transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("transaction_type", "promo")
      .limit(1)
      .single();

    if (!existingPromo) {
      await adminClient.rpc("add_credits", {
        p_user_id: userId,
        p_amount: SIGNUP_BONUS_CREDITS,
        p_transaction_type: "promo",
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: { user_id: userId, credits_awarded: SIGNUP_BONUS_CREDITS },
        meta: {
          request_id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("create-profile error:", err.message);
    return new Response(
      JSON.stringify({ success: false, error: { code: "server_error", message: err.message } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
