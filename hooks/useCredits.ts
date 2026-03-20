// hooks/useCredits.ts
// Credit balance checks and purchase flow.
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { api } from "../services/api";
import type { CreditPackage } from "../services/supabase";
import { useUserStore } from "../stores/userStore";

export function useCredits() {
  const { profile, refreshBalance } = useUserStore();
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [purchasing, setPurchasing] = useState(false);

  const creditBalance = profile?.credit_balance ?? 0;
  const hasCredits = creditBalance > 0;
  const isLowBalance = creditBalance === 1;

  const fetchPackages = useCallback(async () => {
    setLoadingPackages(true);
    const res = await api.getCreditPackages();
    setLoadingPackages(false);
    if (res.success && res.data) {
      setPackages(res.data.packages);
    }
  }, []);

  const purchasePackage = useCallback(
    async (pkg: CreditPackage): Promise<boolean> => {
      setPurchasing(true);
      try {
        const res = await api.createPaymentIntent({ package_id: pkg.id });
        if (!res.success || !res.data?.client_secret) {
          Alert.alert("Payment error", res.error?.message ?? "Could not start payment.");
          return false;
        }

        // Stripe PaymentSheet is initiated in stripe.ts / the store screen.
        // Return client_secret for the caller to present the sheet.
        await refreshBalance();
        return true;
      } finally {
        setPurchasing(false);
      }
    },
    [refreshBalance],
  );

  return {
    creditBalance,
    hasCredits,
    isLowBalance,
    packages,
    loadingPackages,
    purchasing,
    fetchPackages,
    purchasePackage,
  };
}
