// components/StripeWrapper.web.tsx
// Web: no-op wrapper — Stripe React Native is not available in browsers
import type { ReactNode } from "react";

export function StripeWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
