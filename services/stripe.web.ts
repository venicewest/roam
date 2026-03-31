// services/stripe.web.ts
// Web stub — Stripe React Native is not available in the browser.
// The store screen hides purchase buttons on web, so this is never called.
export type PurchaseResult =
  | { success: true }
  | { success: false; cancelled: boolean; error?: string };

export async function purchaseCredits(_packageId: number): Promise<PurchaseResult> {
  return { success: false, cancelled: false, error: "Purchases are not available on web." };
}
