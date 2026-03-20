// app/(tabs)/profile.tsx
import { router } from "expo-router";
import {
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useAuth } from "../../hooks/useAuth";
import { useUserStore } from "../../stores/userStore";

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const { profile } = useUserStore();

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      {/* Avatar / Name */}
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile?.display_name?.[0]?.toUpperCase() ?? "?"}
          </Text>
        </View>
        <Text style={styles.displayName}>
          {profile?.display_name ?? "Traveler"}
        </Text>
      </View>

      {/* Credits Card */}
      <View style={styles.creditsCard}>
        <View style={styles.creditsLeft}>
          <Text style={styles.creditsLabel}>Tour Credits</Text>
          <Text style={styles.creditsValue}>
            {profile?.credit_balance ?? 0}
          </Text>
          <Text style={styles.creditsSubtext}>
            1 credit = 1 tour (up to 3 hrs)
          </Text>
        </View>
        <TouchableOpacity
          style={styles.buyButton}
          onPress={() => router.push("/store")}
        >
          <Text style={styles.buyButtonText}>Buy Credits</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>
            {profile?.lifetime_credits_purchased ?? 0}
          </Text>
          <Text style={styles.statLabel}>Credits purchased</Text>
        </View>
      </View>

      {/* Menu Items */}
      <View style={styles.menu}>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push("/(tabs)/history")}
        >
          <Text style={styles.menuItemText}>📍 Tour History</Text>
          <Text style={styles.menuArrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push("/voice-selector" as any)}
        >
          <Text style={styles.menuItemText}>🎙 Narration Voice</Text>
          <Text style={styles.menuArrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push("/store")}
        >
          <Text style={styles.menuItemText}>💳 Buy Credits</Text>
          <Text style={styles.menuArrow}>→</Text>
        </TouchableOpacity>
      </View>

      {/* Sign Out */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Roam v1.0.0</Text>
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
  avatarSection: {
    alignItems: "center",
    marginBottom: 28,
    marginTop: 12,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#e8c547",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1a1a2e",
  },
  displayName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
  },
  creditsCard: {
    backgroundColor: "#2a2a3e",
    borderRadius: 12,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e8c547",
  },
  creditsLeft: {
    flex: 1,
  },
  creditsLabel: {
    color: "#aaa",
    fontSize: 13,
    marginBottom: 4,
  },
  creditsValue: {
    color: "#e8c547",
    fontSize: 36,
    fontWeight: "800",
  },
  creditsSubtext: {
    color: "#666",
    fontSize: 12,
    marginTop: 2,
  },
  buyButton: {
    backgroundColor: "#e8c547",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buyButtonText: {
    color: "#1a1a2e",
    fontWeight: "700",
    fontSize: 14,
  },
  statsRow: {
    flexDirection: "row",
    marginBottom: 24,
    gap: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: "#2a2a3e",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3a3a5e",
  },
  statValue: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
  },
  statLabel: {
    color: "#888",
    fontSize: 12,
    marginTop: 4,
    textAlign: "center",
  },
  menu: {
    marginBottom: 24,
  },
  menuItem: {
    backgroundColor: "#2a2a3e",
    borderRadius: 10,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#3a3a5e",
  },
  menuItemText: {
    color: "#fff",
    fontSize: 15,
  },
  menuArrow: {
    color: "#666",
    fontSize: 16,
  },
  signOutButton: {
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#c0392b",
    marginBottom: 24,
  },
  signOutText: {
    color: "#c0392b",
    fontSize: 15,
    fontWeight: "600",
  },
  version: {
    color: "#444",
    fontSize: 12,
    textAlign: "center",
  },
});
