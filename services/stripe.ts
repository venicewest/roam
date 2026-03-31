// services/stripe.ts
// Stripe React Native SDK PaymentSheet wrapper.
// Client receives only client_secret — package price is sourced server-side.
import { Alert } from "react-native";
import { api } from "./api";
import { useUserStore } from "../stores/userStore";

// Note: @stripe/stripe-react-native must be initialized in the root layout
// with StripeProvider wrapping the app (publishable key from env).

export type PurchaseResult =
  | { success: true }
  | { success: false; cancelled: boolean; error?: string };

/**
 * Full purchase flow:
 * 1. Create PaymentIntent via Edge Function (returns client_secret)
 * 2. Present Stripe PaymentSheet
 * 3. On success, balance is updated via Stripe webhook → add_credits()
 */
export async function purchaseCredits(packageId: number): Promise<PurchaseResult> {
  // Get client_secret from server
  const intentRes = await api.createPaymentIntent({ package_id: packageId });
  if (!intentRes.success || !intentRes.data?.client_secret) {
    return {
      success: false,
      cancelled: false,
      error: intentRes.error?.message ?? "Could not start payment.",
    };
  }

  try {
    // Dynamic import — avoids crashing if Stripe SDK not installed yet
    const { initPaymentSheet, presentPaymentSheet } = await import(
      "@stripe/stripe-react-native"
    );

    const { error: initError } = await initPaymentSheet({
      paymentIntentClientSecret: intentRes.data.client_secret,
      merchantDisplayName: "Roam",
      style: "alwaysDark",
      appearance: {
        colors: {
          primary: "#e8c547",
          background: "#1a1a2e",
          componentBackground: "#2a2a3e",
          componentBorder: "#3a3a5e",
          componentDivider: "#3a3a5e",
          primaryText: "#ffffff",
          secondaryText: "#aaaaaa",
          componentText: "#ffffff",
          placeholderText: "#666666",
          icon: "#e8c547",
          error: "#ff6b6b",
        },
      },
    });

    if (initError) {
      return { success: false, cancelled: false, error: initError.message };
    }

    const { error: presentError } = await presentPaymentSheet();

    if (presentError) {
      if (presentError.code === "Canceled") {
        return { success: false, cancelled: true };
      }
      return { success: false, cancelled: false, error: presentError.message };
    }

    // Payment succeeded — webhook credits the account async.
    // Poll a few times to pick up the balance update.
    const poll = (attempts: number) => {
      setTimeout(async () => {
        await useUserStore.getState().refreshBalance();
        if (attempts > 1) poll(attempts - 1);
      }, 3000);
    };
    poll(4); // check at 3s, 6s, 9s, 12s

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Payment failed";
    Alert.alert("Payment error", message);
    return { success: false, cancelled: false, error: message };
  }
}
