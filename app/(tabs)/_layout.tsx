// app/(tabs)/_layout.tsx
import { Tabs } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useUserStore } from "../../stores/userStore";

function CreditBadge() {
  const { profile } = useUserStore();
  return (
    <View style={styles.creditBadge}>
      <Text style={styles.creditText}>
        {profile?.credit_balance ?? 0} credits
      </Text>
    </View>
  );
}

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: "#e8c547",
        tabBarInactiveTintColor: "#666",
        tabBarLabelStyle: styles.tabLabel,
        headerStyle: styles.header,
        headerTintColor: "#fff",
        headerTitleStyle: styles.headerTitle,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Explore",
          headerTitle: "roam",
          headerRight: () => <CreditBadge />,
          tabBarIcon: ({ focused }) => <TabIcon emoji="🗺️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "Tours",
          tabBarIcon: ({ focused }) => <TabIcon emoji="📍" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="store"
        options={{
          href: null, // hides from tab bar but keeps the route accessible
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: "#1a1a2e",
    borderTopColor: "#2a2a3e",
    borderTopWidth: 1,
    height: 60,
    paddingBottom: 8,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  header: {
    backgroundColor: "#1a1a2e",
    shadowColor: "transparent",
    elevation: 0,
  },
  headerTitle: {
    color: "#e8c547",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 3,
  },
  creditBadge: {
    backgroundColor: "#2a2a3e",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginRight: 16,
    borderWidth: 1,
    borderColor: "#e8c547",
  },
  creditText: {
    color: "#e8c547",
    fontSize: 12,
    fontWeight: "700",
  },
});
