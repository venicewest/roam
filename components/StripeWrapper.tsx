// components/StripeWrapper.tsx
// Native: wraps children in Stripe's StripeProvider
import { StripeProvider } from "@stripe/stripe-react-native";
import type { ReactNode } from "react";

const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

export function StripeWrapper({ children }: { children: ReactNode }) {
  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
      {children}
    </StripeProvider>
  );
}
