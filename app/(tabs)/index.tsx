// app/(tabs)/index.tsx
import * as Location from "expo-location";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { api } from "../../services/api";
import { SubmitPoiSheet } from '../../components/shared/SubmitPoiSheet';

const COVERAGE_LABELS: Record<string, string> = {
  excellent: "Excellent coverage",
  good: "Good coverage",
  fair: "Fair coverage",
  sparse: "Limited coverage",
};
const COVERAGE_COLORS: Record<string, string> = {
  excellent: "#4caf50",
  good: "#8bc34a",
  fair: "#ff9800",
  sparse: "#607d8b",
};
import { useSessionStore } from "../../stores/sessionStore";
import { useUserStore } from "../../stores/userStore";

export default function HomeScreen() {
  const { startSession } = useSessionStore();
  const {
    profile,
    categories,
    selectedCategoryIds,
    toggleCategory,
    savePreferences,
    fetchProfile,
  } = useUserStore();

  const [showSuggest, setShowSuggest] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);
  const [checkingLocation, setCheckingLocation] = useState(true);
  const [startingTour, setStartingTour] = useState(false);
  const [depthTier, setDepthTier] = useState<'quick' | 'full' | 'expert'>('full');
  const [coverage, setCoverage] = useState<{
    quality: "excellent" | "good" | "fair" | "sparse";
    total_pois: number;
  } | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check location permissions on mount
  useEffect(() => {
    checkLocationPermission();
    fetchProfile();
    fetchCoverage();
  }, []);

  const fetchCoverage = async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const geocode = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      const city = geocode[0]?.city ?? geocode[0]?.region;
      if (!city) return;
      const res = await api.getCityCoverage(city);
      if (res.success && res.data) {
        setCoverage({ quality: res.data.quality, total_pois: res.data.total_pois });
      }
    } catch {
      // Coverage is non-critical — silently skip on any error
    }
  };

  const checkLocationPermission = async () => {
    setCheckingLocation(true);
    const { status } = await Location.getForegroundPermissionsAsync();
    setLocationGranted(status === "granted");
    setCheckingLocation(false);
  };

  const requestLocationPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationGranted(status === "granted");
    if (status !== "granted") {
      Alert.alert(
        "Location Required",
        "Roam needs your location to find interesting places nearby. Please enable location access in your device settings.",
        [{ text: "OK" }],
      );
    }
  };

  // Debounced preference save — fires 500ms after last toggle
  const handleToggleCategory = (categoryId: number) => {
    toggleCategory(categoryId);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      savePreferences();
    }, 500);
  };

  const handleStartTour = async (isGroup: boolean) => {
    if (!locationGranted) {
      await requestLocationPermission();
      return;
    }

    if ((profile?.credit_balance ?? 0) < 1) {
      Alert.alert("No Credits", "You need at least 1 credit to start a tour.", [
        { text: "Cancel", style: "cancel" },
        { text: "Buy Credits", onPress: () => router.push("/store") },
      ]);
      return;
    }

    if (selectedCategoryIds.length === 0) {
      Alert.alert(
        "No Interests Selected",
        "Please select at least one interest category before starting a tour.",
      );
      return;
    }

    setStartingTour(true);

    // Get current location to determine city
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const geocode = await Location.reverseGeocodeAsync({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    });

    const city = geocode[0]?.city ?? geocode[0]?.region ?? "Unknown";

    const result = await api.startTourSession({
      interest_category_ids: selectedCategoryIds,
      city,
      is_group_tour: isGroup,
      depth_tier: depthTier,
    });

    setStartingTour(false);

    if (!result.success || !result.data) {
      const msg = result.error?.message ?? "Please try again";
      console.log("startTourSession failed:", JSON.stringify(result));
      Alert.alert("Could not start tour", msg);
      return;
    }

    startSession({
      id: result.data.session_id,
      host_user_id: "",
      join_code: result.data.join_code,
      is_group_tour: isGroup,
      guest_count: 0,
      interest_category_ids: selectedCategoryIds,
      city,
      credits_charged: 0,
      billing_status: "open",
      status: "active",
      started_at: new Date().toISOString(),
      ended_at: null,
      route_polyline: null,
      total_distance_meters: null,
    });

    router.push(`/tour/${result.data.session_id}`);
  };

  if (checkingLocation) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#e8c547" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      {/* Location warning */}
      {!locationGranted && (
        <TouchableOpacity
          style={styles.locationBanner}
          onPress={requestLocationPermission}
        >
          <Text style={styles.locationBannerText}>
            📍 Tap to enable location — required for tours
          </Text>
        </TouchableOpacity>
      )}

      {/* Interest Categories */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>What are you interested in?</Text>
        <Text style={styles.sectionSubtitle}>
          Roam will narrate facts matching your selections as you walk.
        </Text>

        {categories.map((category) => (
          <TouchableOpacity
            key={category.id}
            style={styles.categoryRow}
            onPress={() => handleToggleCategory(category.id)}
            activeOpacity={0.7}
          >
            <View style={styles.categoryLeft}>
              <Text style={styles.categoryLabel}>{category.label}</Text>
            </View>
            <Switch
              value={selectedCategoryIds.includes(category.id)}
              onValueChange={() => handleToggleCategory(category.id)}
              trackColor={{ false: "#3a3a5e", true: "#e8c547" }}
              thumbColor="#fff"
            />
          </TouchableOpacity>
        ))}
      </View>

      {/* City Coverage Indicator */}
      {coverage && (
        <View style={[styles.coverageBadge, { borderColor: COVERAGE_COLORS[coverage.quality] }]}>
          <Text style={[styles.coverageText, { color: COVERAGE_COLORS[coverage.quality] }]}>
            {COVERAGE_LABELS[coverage.quality]} · {coverage.total_pois} POIs
          </Text>
        </View>
      )}

      {/* Depth tier selector */}
      <View style={styles.tierRow}>
        <Text style={styles.tierLabel}>Narration depth</Text>
        <View style={styles.tierButtons}>
          {(['quick', 'full', 'expert'] as const).map((tier) => (
            <TouchableOpacity
              key={tier}
              style={[styles.tierBtn, depthTier === tier && styles.tierBtnActive]}
              onPress={() => setDepthTier(tier)}
            >
              <Text style={[styles.tierBtnText, depthTier === tier && styles.tierBtnTextActive]}>
                {tier.charAt(0).toUpperCase() + tier.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Start Tour Buttons */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.primaryButton, startingTour && styles.buttonDisabled]}
          onPress={() => handleStartTour(false)}
          disabled={startingTour}
        >
          {startingTour ? (
            <ActivityIndicator color="#1a1a2e" />
          ) : (
            <>
              <Text style={styles.primaryButtonText}>▶ Start Solo Tour</Text>
              <Text style={styles.primaryButtonSub}>
                1 credit · up to 3 hours
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.secondaryButton,
            startingTour && styles.buttonDisabled,
          ]}
          onPress={() => handleStartTour(true)}
          disabled={startingTour}
        >
          <Text style={styles.secondaryButtonText}>👥 Start Group Tour</Text>
          <Text style={styles.secondaryButtonSub}>
            Share a code · guests join free
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setShowSuggest(true)}
          style={styles.suggestButton}
        >
          <Text style={styles.suggestText}>+ Suggest</Text>
        </TouchableOpacity>
      </View>

      {/* Low balance nudge */}
      {(profile?.credit_balance ?? 0) <= 1 && (
        <TouchableOpacity
          style={styles.lowBalanceBanner}
          onPress={() => router.push("/store")}
        >
          <Text style={styles.lowBalanceText}>
            {profile?.credit_balance === 0
              ? "⚠️ No credits left — tap to buy more"
              : "⚡ 1 credit remaining — tap to stock up"}
          </Text>
        </TouchableOpacity>
      )}

      <SubmitPoiSheet visible={showSuggest} onClose={() => setShowSuggest(false)} />
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
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    justifyContent: "center",
    alignItems: "center",
  },
  locationBanner: {
    backgroundColor: "#2a2a3e",
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#e8c547",
  },
  locationBannerText: {
    color: "#e8c547",
    fontSize: 14,
    textAlign: "center",
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
  },
  sectionSubtitle: {
    color: "#888",
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#2a2a3e",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#3a3a5e",
  },
  categoryLeft: {
    flex: 1,
  },
  categoryLabel: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  primaryButton: {
    backgroundColor: "#e8c547",
    borderRadius: 12,
    padding: 18,
    alignItems: "center",
    marginBottom: 12,
  },
  primaryButtonText: {
    color: "#1a1a2e",
    fontSize: 17,
    fontWeight: "800",
  },
  primaryButtonSub: {
    color: "#1a1a2e",
    fontSize: 12,
    marginTop: 4,
    opacity: 0.7,
  },
  secondaryButton: {
    backgroundColor: "#2a2a3e",
    borderRadius: 12,
    padding: 18,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3a3a5e",
  },
  secondaryButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  secondaryButtonSub: {
    color: "#888",
    fontSize: 12,
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  lowBalanceBanner: {
    backgroundColor: "#2a1a0e",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e87c47",
  },
  lowBalanceText: {
    color: "#e87c47",
    fontSize: 14,
    textAlign: "center",
    fontWeight: "600",
  },
  coverageBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
    alignSelf: "flex-start",
  },
  coverageText: {
    fontSize: 12,
    fontWeight: "600",
  },
  tierRow: { marginBottom: 16 },
  tierLabel: { color: '#888', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  tierButtons: { flexDirection: 'row', gap: 8 },
  tierBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8,
    backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a2a4e',
    alignItems: 'center',
  },
  tierBtnActive: { backgroundColor: '#1a2a1a', borderColor: '#4a7c4a' },
  tierBtnText: { color: '#666', fontSize: 13, fontWeight: '600' },
  tierBtnTextActive: { color: '#7ac47a' },
  suggestButton: { borderWidth: 1, borderColor: '#f0a500', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginTop: 10, alignItems: 'center' },
  suggestText: { color: '#f0a500', fontSize: 13, fontWeight: '600' },
});
