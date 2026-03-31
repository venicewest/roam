// supabase/functions/stripe-webhook/index.ts
// Validates Stripe signature, idempotency-checks, then credits the account.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY")!;
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

  const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }

  if (event.type !== "payment_intent.succeeded") {
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const intent = event.data.object as Stripe.PaymentIntent;
    const { user_id, credit_amount } = intent.metadata;

    if (!user_id || !credit_amount) {
      console.error("Missing metadata on PaymentIntent:", intent.id);
      return new Response("Missing metadata", { status: 400 });
    }

    // Idempotency: check if already processed
    const { data: existing } = await adminClient
      .from("credit_transactions")
      .select("id")
      .eq("stripe_payment_intent_id", intent.id)
      .single();

    if (existing) {
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Credit the account
    await adminClient.rpc("add_credits", {
      p_user_id: user_id,
      p_amount: parseInt(credit_amount, 10),
      p_transaction_type: "purchase",
      p_stripe_payment_intent: intent.id,
    });

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook processing error:", err.message);
    return new Response(`Server error: ${err.message}`, { status: 500 });
  }
});
