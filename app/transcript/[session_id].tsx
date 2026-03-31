// app/transcript/[session_id].tsx
// Tour history detail: ordered POI list with narratives, ratings, and flags.
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { api } from "../../services/api";
import type { TourSession, TourSessionPoi } from "../../services/supabase";
import { formatDistance, formatDuration, formatRelativeTime } from "../../utils/formatting";

const FLAG_OPTIONS = [
  { value: "inaccurate", label: "Inaccurate" },
  { value: "offensive", label: "Offensive" },
  { value: "boring", label: "Not interesting" },
  { value: "too_long", label: "Too long" },
  { value: "wrong_location", label: "Wrong location" },
] as const;

type Stop = TourSessionPoi & { pois?: { name: string | null; narrative: string; category_id: number } };

export default function TranscriptScreen() {
  const { session_id } = useLocalSearchParams<{ session_id: string }>();
  const [session, setSession] = useState<TourSession | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [flagging, setFlagging] = useState<string | null>(null);

  useEffect(() => {
    if (!session_id) return;
    api.getTourTranscript(session_id).then((res) => {
      if (res.success && res.data) {
        setSession(res.data.session as TourSession);
        setStops(res.data.stops as Stop[]);
        // Pre-populate existing ratings
        const existing: Record<string, number> = {};
        (res.data.stops as Stop[]).forEach((s) => {
          if (s.rating) existing[s.id] = s.rating;
        });
        setRatings(existing);
      }
      setLoading(false);
    });
  }, [session_id]);

  const handleRate = async (stop: Stop, rating: number) => {
    setRatings((r) => ({ ...r, [stop.id]: rating }));
    await api.ratePoi({ session_poi_id: stop.id, rating });
  };

  const handleFlag = async (stop: Stop, flag: string) => {
    setFlagging(null);
    await api.ratePoi({ session_poi_id: stop.id, flag_reason: flag });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e8c547" />
      </View>
    );
  }

  const durationSeconds = session?.ended_at && session?.started_at
    ? (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000
    : null;

  return (
    <View style={styles.container}>
      {/* Session summary header */}
      {session && (
        <View style={styles.header}>
          <Text style={styles.city}>{session.city}</Text>
          <Text style={styles.date}>{formatRelativeTime(session.started_at)}</Text>
          <View style={styles.metaRow}>
            {durationSeconds !== null && (
              <Text style={styles.meta}>{formatDuration(durationSeconds)}</Text>
            )}
            {session.total_distance_meters ? (
              <Text style={styles.meta}>{formatDistance(session.total_distance_meters)}</Text>
            ) : null}
            <Text style={styles.meta}>{stops.length} stops</Text>
            {session.credits_charged > 0 && (
              <Text style={styles.meta}>{session.credits_charged} credit used</Text>
            )}
          </View>
        </View>
      )}

      {stops.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No stops were narrated on this tour.</Text>
        </View>
      ) : (
        <FlatList
          data={stops}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: stop, index }) => {
            const isExpanded = expandedId === stop.id;
            const isFlagging = flagging === stop.id;
            const rating = ratings[stop.id] ?? null;

            return (
              <View style={styles.stopCard}>
                <TouchableOpacity
                  onPress={() => setExpandedId(isExpanded ? null : stop.id)}
                  activeOpacity={0.8}
                >
                  <View style={styles.stopHeader}>
                    <View style={styles.stopIndex}>
                      <Text style={styles.stopIndexText}>{index + 1}</Text>
                    </View>
                    <View style={styles.stopMeta}>
                      <Text style={styles.stopName}>
                        {stop.pois?.name ?? "Unknown location"}
                      </Text>
                      <Text style={styles.stopTime}>
                        {formatRelativeTime(stop.narrated_at)}
                        {stop.was_ai_generated ? " · AI" : ""}
                      </Text>
                    </View>
                    <Text style={styles.expandIcon}>{isExpanded ? "▲" : "▼"}</Text>
                  </View>
                </TouchableOpacity>

                {isExpanded && (
                  <View style={styles.stopBody}>
                    {stop.pois?.narrative ? (
                      <ScrollView style={styles.narrativeScroll} nestedScrollEnabled>
                        <Text style={styles.narrative}>{stop.pois.narrative}</Text>
                      </ScrollView>
                    ) : null}

                    {/* Rating stars */}
                    <View style={styles.ratingRow}>
                      <Text style={styles.ratingLabel}>
                        {rating ? "Your rating:" : "Rate this stop:"}
                      </Text>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <TouchableOpacity
                          key={star}
                          onPress={() => handleRate(stop, star)}
                        >
                          <Text style={[styles.star, rating !== null && rating >= star && styles.starFilled]}>
                            ★
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {/* Flag */}
                    {!isFlagging ? (
                      <TouchableOpacity
                        style={styles.flagButton}
                        onPress={() => setFlagging(stop.id)}
                      >
                        <Text style={styles.flagButtonText}>Report an issue</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.flagOptions}>
                        <Text style={styles.flagPrompt}>What's the issue?</Text>
                        {FLAG_OPTIONS.map((opt) => (
                          <TouchableOpacity
                            key={opt.value}
                            style={styles.flagOption}
                            onPress={() => handleFlag(stop, opt.value)}
                          >
                            <Text style={styles.flagOptionText}>{opt.label}</Text>
                          </TouchableOpacity>
                        ))}
                        <TouchableOpacity onPress={() => setFlagging(null)}>
                          <Text style={styles.flagCancel}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  emptyText: { color: "#666", fontSize: 15 },
  header: {
    backgroundColor: "#2a2a3e",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#3a3a5e",
  },
  city: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 4 },
  date: { color: "#888", fontSize: 13, marginBottom: 10 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  meta: { color: "#e8c547", fontSize: 13, fontWeight: "600" },
  list: { padding: 16, paddingBottom: 40 },
  stopCard: {
    backgroundColor: "#2a2a3e",
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#3a3a5e",
    overflow: "hidden",
  },
  stopHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  stopIndex: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#e8c547",
    alignItems: "center",
    justifyContent: "center",
  },
  stopIndexText: { color: "#1a1a2e", fontSize: 12, fontWeight: "800" },
  stopMeta: { flex: 1 },
  stopName: { color: "#fff", fontSize: 14, fontWeight: "600" },
  stopTime: { color: "#666", fontSize: 12, marginTop: 2 },
  expandIcon: { color: "#555", fontSize: 12 },
  stopBody: {
    padding: 14,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: "#3a3a5e",
  },
  narrativeScroll: { maxHeight: 160, marginBottom: 14 },
  narrative: { color: "#ccc", fontSize: 14, lineHeight: 22 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  ratingLabel: { color: "#aaa", fontSize: 13, marginRight: 4 },
  star: { fontSize: 22, color: "#3a3a5e" },
  starFilled: { color: "#e8c547" },
  flagButton: { alignSelf: "flex-start" },
  flagButtonText: { color: "#555", fontSize: 12 },
  flagOptions: { marginTop: 8 },
  flagPrompt: { color: "#aaa", fontSize: 13, marginBottom: 8 },
  flagOption: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#3a3a5e",
  },
  flagOptionText: { color: "#fff", fontSize: 14 },
  flagCancel: { color: "#e8c547", fontSize: 13, marginTop: 10 },
});
