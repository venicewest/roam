// app/(tabs)/store.tsx
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import type { CreditPackage } from "../../services/supabase";
import { useCredits } from "../../hooks/useCredits";
import { purchaseCredits } from "../../services/stripe";
import { useUserStore } from "../../stores/userStore";
import { formatPrice, formatCredits } from "../../utils/formatting";

export default function StoreScreen() {
  const { creditBalance, packages, loadingPackages, fetchPackages } = useCredits();
  const refreshBalance = useUserStore((s) => s.refreshBalance);
  const [purchasing, setPurchasing] = useState<number | null>(null);

  useEffect(() => {
    fetchPackages();
    refreshBalance();
  }, []);

  const handlePurchase = async (pkg: CreditPackage) => {
    setPurchasing(pkg.id);
    const result = await purchaseCredits(pkg.id);
    setPurchasing(null);

    if (result.success) {
      // Eagerly refresh so the UI updates without waiting for the poll in stripe.ts
      await refreshBalance();
      Alert.alert(
        "Purchase complete!",
        `${formatCredits(pkg.credit_amount)} added to your account.`,
      );
    } else if (!result.cancelled) {
      Alert.alert("Purchase failed", result.error ?? "Please try again.");
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Buy Credits</Text>
      <Text style={styles.subtitle}>
        1 credit = 1 tour session up to 3 hours.{"\n"}
        Group tours only charge the host.{"\n"}
        Current balance: {formatCredits(creditBalance)}
      </Text>

      {loadingPackages ? (
        <ActivityIndicator color="#e8c547" style={{ marginTop: 32 }} />
      ) : (
        packages.map((pkg) => (
          <View
            key={pkg.id}
            style={[styles.card, pkg.is_featured && styles.cardFeatured]}
          >
            {pkg.is_featured && (
              <View style={styles.featuredBadge}>
                <Text style={styles.featuredBadgeText}>BEST VALUE</Text>
              </View>
            )}
            <View style={styles.cardTop}>
              <Text style={styles.packageName}>{pkg.name}</Text>
              <Text style={styles.packagePrice}>{formatPrice(pkg.price_cents)}</Text>
            </View>
            <Text style={styles.packageCredits}>{formatCredits(pkg.credit_amount)}</Text>
            <TouchableOpacity
              style={[styles.buyButton, pkg.is_featured && styles.buyButtonFeatured]}
              onPress={() => handlePurchase(pkg)}
              disabled={purchasing !== null}
            >
              {purchasing === pkg.id ? (
                <ActivityIndicator color={pkg.is_featured ? "#1a1a2e" : "#fff"} />
              ) : (
                <Text
                  style={[
                    styles.buyButtonText,
                    pkg.is_featured && styles.buyButtonTextFeatured,
                  ]}
                >
                  Purchase
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ))
      )}

      <Text style={styles.note}>
        Payments processed securely via Stripe.{"\n"}
        Credits never expire.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  scroll: {
    padding: 20,
    paddingBottom: 48,
  },
  backButton: {
    marginBottom: 20,
  },
  backText: {
    color: "#e8c547",
    fontSize: 16,
  },
  title: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 8,
  },
  subtitle: {
    color: "#888",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 28,
  },
  card: {
    backgroundColor: "#2a2a3e",
    borderRadius: 12,
    padding: 20,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#3a3a5e",
  },
  cardFeatured: {
    borderColor: "#e8c547",
    borderWidth: 2,
  },
  featuredBadge: {
    backgroundColor: "#e8c547",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: "flex-start",
    marginBottom: 10,
  },
  featuredBadgeText: {
    color: "#1a1a2e",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  packageName: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  packagePrice: {
    color: "#e8c547",
    fontSize: 22,
    fontWeight: "800",
  },
  packageCredits: {
    color: "#aaa",
    fontSize: 14,
    marginBottom: 16,
  },
  buyButton: {
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3a3a5e",
  },
  buyButtonFeatured: {
    backgroundColor: "#e8c547",
    borderColor: "#e8c547",
  },
  buyButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  buyButtonTextFeatured: {
    color: "#1a1a2e",
  },
  note: {
    color: "#555",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 8,
  },
});
