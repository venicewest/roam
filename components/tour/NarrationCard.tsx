// components/tour/NarrationCard.tsx
// Slides up during narration. Shows POI name + subtle rating nudge after 8s.
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { QueuedPoi } from "../../stores/sessionStore";

type Props = {
  poi: QueuedPoi | null;
  onRate: (poiId: string, rating: number) => void;
};

export function NarrationCard({ poi, onRate }: Props) {
  const translateY = useRef(new Animated.Value(200)).current;
  const [showRating, setShowRating] = useState(false);

  useEffect(() => {
    if (poi) {
      setShowRating(false);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 6,
      }).start();

      // Show rating nudge after 8s (spec: 8-second fade)
      const timer = setTimeout(() => setShowRating(true), 8000);
      return () => clearTimeout(timer);
    } else {
      Animated.timing(translateY, {
        toValue: 200,
        duration: 300,
        useNativeDriver: true,
      }).start();
      setShowRating(false);
    }
  }, [poi?.id]);

  if (!poi) return null;

  return (
    <Animated.View style={[styles.card, { transform: [{ translateY }] }]}>
      <View style={styles.indicator} />
      <Text style={styles.name}>{poi.name ?? "Nearby location"}</Text>
      <Text style={styles.status}>Narrating…</Text>

      {showRating && (
        <View style={styles.ratingRow}>
          <Text style={styles.ratingPrompt}>How was this?</Text>
          {[1, 2, 3, 4, 5].map((star) => (
            <TouchableOpacity
              key={star}
              onPress={() => onRate(poi.id, star)}
              style={styles.star}
            >
              <Text style={styles.starText}>★</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    bottom: 100,
    left: 16,
    right: 16,
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#e8c547",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#e8c547",
    marginBottom: 10,
  },
  name: { fontSize: 18, fontWeight: "700", color: "#fff", marginBottom: 4 },
  status: { fontSize: 13, color: "#aaa" },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    gap: 8,
  },
  ratingPrompt: { color: "#aaa", fontSize: 13, marginRight: 4 },
  star: { padding: 4 },
  starText: { fontSize: 22, color: "#e8c547" },
});
