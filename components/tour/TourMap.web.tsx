// components/tour/TourMap.web.tsx
// Web stub — react-native-maps is not available in browsers.
// The tour screen is native-only; the /join page doesn't use a map.
import { StyleSheet, Text, View } from "react-native";
import type { PoiTileItem } from "../../services/supabase";
import type { LocationFix } from "../../hooks/useLocation";

type Props = {
  location: LocationFix | null;
  pois: PoiTileItem[];
  currentPoiId: string | null;
  onPoiPress?: (poi: PoiTileItem) => void;
};

export function TourMap({ pois }: Props) {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.text}>Map not available in browser</Text>
      <Text style={styles.sub}>{pois.length} POIs loaded</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#1a1a2e",
    alignItems: "center",
    justifyContent: "center",
  },
  text: { color: "#aaa", fontSize: 16 },
  sub: { color: "#555", fontSize: 13, marginTop: 8 },
});
