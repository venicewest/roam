// components/tour/GroupBadge.tsx
import { Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { JOIN_BASE_URL } from "../../constants/config";

type Props = {
  guestCount: number;
  joinCode: string;
};

export function GroupBadge({ guestCount, joinCode }: Props) {
  const joinUrl = `${JOIN_BASE_URL}/join?code=${joinCode}`;

  const handleShare = async () => {
    await Share.share({
      message: `Join my Roam tour! Open this link on your phone's browser:\n${joinUrl}\n\nOr go to ${JOIN_BASE_URL}/join and enter code: ${joinCode}`,
      url: joinUrl,
    });
  };

  return (
    <TouchableOpacity style={styles.badge} onPress={handleShare} activeOpacity={0.8}>
      <Text style={styles.code}>{joinCode}</Text>
      <Text style={styles.guests}>
        {guestCount} {guestCount === 1 ? "guest" : "guests"}
      </Text>
      <Text style={styles.shareHint}>Tap to share</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: 60,
    left: 16,
    backgroundColor: "#1a1a2edd",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#e8c547",
    alignItems: "center",
  },
  code: {
    color: "#e8c547",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 3,
  },
  guests: { color: "#aaa", fontSize: 12, marginTop: 2 },
  shareHint: { color: "#555", fontSize: 10, marginTop: 4 },
});
