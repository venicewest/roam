// app/(tabs)/history.tsx
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { supabase, TourSession } from "../../services/supabase";

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "In progress";
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatDistance(meters: number | null): string {
  if (!meters) return "";
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type TourWithCount = TourSession & { stop_count: number };

export default function HistoryScreen() {
  const [tours, setTours] = useState<TourWithCount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTours();
  }, []);

  const fetchTours = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    // Single query: join stop counts via embedded select
    const { data } = await supabase
      .from("tour_sessions")
      .select("*, tour_session_pois(count)")
      .eq("host_user_id", user.id)
      .eq("status", "completed")
      .order("started_at", { ascending: false })
      .limit(50);

    if (!data) {
      setLoading(false);
      return;
    }

    const withCounts = data.map((session: any) => ({
      ...session,
      stop_count: session.tour_session_pois?.[0]?.count ?? 0,
    }));

    setTours(withCounts);
    setLoading(false);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e8c547" />
      </View>
    );
  }

  if (tours.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyEmoji}>🗺️</Text>
        <Text style={styles.emptyTitle}>No tours yet</Text>
        <Text style={styles.emptySubtitle}>
          Start your first tour from the Explore tab
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={tours}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onPress={() => router.push(`/transcript/${item.id}` as any)}
            activeOpacity={0.8}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardCity}>{item.city}</Text>
              <Text style={styles.cardDate}>{formatDate(item.started_at)}</Text>
            </View>
            <View style={styles.cardMeta}>
              <Text style={styles.metaItem}>
                ⏱ {formatDuration(item.started_at, item.ended_at)}
              </Text>
              {item.total_distance_meters ? (
                <Text style={styles.metaItem}>
                  📏 {formatDistance(item.total_distance_meters)}
                </Text>
              ) : null}
              <Text style={styles.metaItem}>📍 {item.stop_count} stops</Text>
              {item.is_group_tour && (
                <Text style={styles.metaItem}>👥 Group tour</Text>
              )}
            </View>
            <Text style={styles.cardArrow}>View transcript →</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  centered: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  emptySubtitle: {
    color: "#888",
    fontSize: 14,
    textAlign: "center",
  },
  list: {
    padding: 16,
  },
  card: {
    backgroundColor: "#2a2a3e",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#3a3a5e",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  cardCity: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  cardDate: {
    color: "#888",
    fontSize: 13,
  },
  cardMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12,
  },
  metaItem: {
    color: "#aaa",
    fontSize: 13,
  },
  cardArrow: {
    color: "#e8c547",
    fontSize: 13,
    fontWeight: "600",
  },
});
