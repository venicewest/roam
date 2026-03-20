// components/tour/PoiDrawer.tsx
// Bottom drawer showing live narration transcript during tour.
import { FlatList, StyleSheet, Text, View } from "react-native";
import type { NarrationEvent } from "../../stores/sessionStore";
import { usePoiStore } from "../../stores/poiStore";
import { formatRelativeTime } from "../../utils/formatting";

type Props = {
  events: NarrationEvent[];
};

export function PoiDrawer({ events }: Props) {
  const { getPoiById } = usePoiStore();

  if (events.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Stops will appear here as you walk.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={[...events].reverse()}
      keyExtractor={(_, i) => String(i)}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => {
        const poi = getPoiById(item.poi_id);
        return (
          <View style={styles.item}>
            <View style={styles.dot} />
            <View style={styles.content}>
              <Text style={styles.poiName}>{poi?.name ?? "Unknown location"}</Text>
              <Text style={styles.time}>{formatRelativeTime(item.narrated_at)}</Text>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", paddingVertical: 24 },
  emptyText: { color: "#666", fontSize: 14 },
  list: { paddingBottom: 20 },
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a3e",
    gap: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#e8c547",
    marginTop: 4,
  },
  content: { flex: 1 },
  poiName: { color: "#fff", fontSize: 14, fontWeight: "600" },
  time: { color: "#666", fontSize: 12, marginTop: 2 },
});
