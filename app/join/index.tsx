// app/join/index.tsx
// Guest tour join page — accessible via web at /join?code=XXXXXX or manual entry.
// No authentication required. Guests enter a 6-digit join code, unlock audio with
// a tap gesture (required by browsers), then hear narrations in real time.
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Audio } from "expo-av";
import { supabase } from "../../services/supabase";
import { api } from "../../services/api";
import { RECONNECT_CATCHUP_WINDOW_SECONDS } from "../../constants/config";

type Phase =
  | "enter_code"
  | "validating"
  | "unlock_audio"
  | "listening"
  | "ended"
  | "error";

type NarrationEvent = {
  poi_id: string;
  audio_url: string;
  poi_name: string;
  received_at: number;
};

type TranscriptCard = {
  poi_name: string;
  category_name?: string;
  poi_description?: string;
  received_at: number;
};

export default function JoinScreen() {
  const params = useLocalSearchParams<{ code?: string }>();

  const [phase, setPhase] = useState<Phase>("enter_code");
  const [code, setCode] = useState((params.code ?? "").toUpperCase());
  const [sessionInfo, setSessionInfo] = useState<{
    session_id: string;
    city: string;
    host_display_name: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [currentPoiName, setCurrentPoiName] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptCard[]>([]);
  const [nowPlaying, setNowPlaying] = useState<{
    poi_name: string;
    category_name?: string;
    poi_description?: string;
  } | null>(null);
  const [hostPaused, setHostPaused] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const soundRef = useRef<import("expo-av").Audio.Sound | null>(null);
  const pendingRef = useRef<NarrationEvent[]>([]);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);

  // Auto-validate if code is provided via URL
  useEffect(() => {
    if (params.code && params.code.length === 6) {
      validateCode(params.code.toUpperCase());
    }
  }, []);

  const validateCode = async (joinCode: string) => {
    setPhase("validating");
    setErrorMsg("");

    const res = await api.validateJoinCode({ join_code: joinCode });

    if (!res.success || !res.data) {
      setErrorMsg(res.error?.message ?? "Tour not found or no longer active.");
      setPhase("enter_code");
      return;
    }

    setSessionInfo(res.data);
    setCode(joinCode);
    setPhase("unlock_audio");
  };

  const handleUnlockAndJoin = async () => {
    if (!sessionInfo) return;

    // Notify server that a guest joined
    await api.guestJoined({ join_code: code });

    // Set up audio mode (must be called after a user gesture on web)
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (_e) {
      // Not critical on web
    }

    // Enable Wake Lock on web to prevent screen sleeping
    if (Platform.OS === "web" && "wakeLock" in navigator) {
      try {
        // @ts-ignore — WakeLock API types not in RN types
        await navigator.wakeLock.request("screen");
      } catch (_e) {
        // WakeLock not available in all browsers
      }
    }

    setPhase("listening");
    subscribeToChannel(code);
  };

  const subscribeToChannel = (joinCode: string) => {
    const channel = supabase.channel(`tour:${joinCode}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "POI_NARRATE" }, ({ payload }) => {
        const event: NarrationEvent = {
          poi_id: payload.poi_id,
          audio_url: payload.audio_url,
          poi_name: payload.poi_name,
          received_at: Date.now(),
        };

        // Check if this narration is recent enough to play (catchup window)
        const ageSeconds = (Date.now() - event.received_at) / 1000;
        if (ageSeconds <= RECONNECT_CATCHUP_WINDOW_SECONDS) {
          pendingRef.current.push(event);
          playNext();
        }

        // Update Now Playing
        setNowPlaying({
          poi_name: payload.poi_name,
          category_name: payload.category_name,
          poi_description: payload.poi_description,
        });

        // Append to transcript
        setTranscript((prev) => [
          ...prev,
          {
            poi_name: payload.poi_name,
            category_name: payload.category_name,
            poi_description: payload.poi_description,
            received_at: Date.now(),
          },
        ]);
        setHostPaused(false);
      })
      .on("broadcast", { event: "SESSION_STATE" }, ({ payload }) => {
        if (payload.status === "ended") {
          channel.unsubscribe();
          channelRef.current = null;
          setPhase("ended");
        } else if (payload.status === "paused") {
          setHostPaused(true);
          soundRef.current?.pauseAsync().catch(() => {});
        } else if (payload.status === "resumed") {
          setHostPaused(false);
          soundRef.current?.playAsync().catch(() => {});
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          reconnectAttempts.current = 0;
          clearReconnectTimeout();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          scheduleReconnect(joinCode);
        }
      });

    channelRef.current = channel;
  };

  const playNext = async () => {
    if (pendingRef.current.length === 0) return;
    if (soundRef.current) return; // already playing

    const event = pendingRef.current.shift()!;
    setCurrentPoiName(event.poi_name);

    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: event.audio_url },
        { shouldPlay: true },
      );
      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          soundRef.current = null;
          setCurrentPoiName(null);
          playNext();
        }
      });
    } catch (_e) {
      soundRef.current = null;
      setCurrentPoiName(null);
      playNext();
    }
  };

  const scheduleReconnect = (joinCode: string) => {
    clearReconnectTimeout();
    const backoffMs = Math.min(1000 * 2 ** reconnectAttempts.current, 30_000);
    reconnectAttempts.current += 1;

    reconnectTimeoutRef.current = setTimeout(() => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
      subscribeToChannel(joinCode);
    }, backoffMs);
  };

  const clearReconnectTimeout = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };

  // Re-subscribe when page becomes visible again (screen-on after screen-off)
  useEffect(() => {
    if (Platform.OS !== "web") return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && phase === "listening") {
        // Reconnect if channel dropped while page was hidden
        if (!channelRef.current) {
          subscribeToChannel(code);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [phase, code]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearReconnectTimeout();
      channelRef.current?.unsubscribe();
      soundRef.current?.unloadAsync();
    };
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────

  if (phase === "enter_code" || phase === "validating") {
    return (
      <View style={styles.container}>
        <Text style={styles.logo}>Roam</Text>
        <Text style={styles.title}>Join a Tour</Text>
        <Text style={styles.subtitle}>Enter the 6-character code shown on the host's screen.</Text>

        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          placeholder="XXXXXX"
          placeholderTextColor="#555"
          maxLength={6}
          autoCapitalize="characters"
          autoCorrect={false}
        />

        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

        <TouchableOpacity
          style={[styles.button, (code.length < 6 || phase === "validating") && styles.buttonDisabled]}
          onPress={() => validateCode(code)}
          disabled={code.length < 6 || phase === "validating"}
        >
          {phase === "validating" ? (
            <ActivityIndicator color="#1a1a2e" />
          ) : (
            <Text style={styles.buttonText}>Verify Code</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === "unlock_audio") {
    return (
      <View style={styles.container}>
        <Text style={styles.logo}>Roam</Text>
        <Text style={styles.title}>Ready to explore {sessionInfo?.city}?</Text>
        <Text style={styles.subtitle}>
          Hosted by {sessionInfo?.host_display_name}.{"\n\n"}
          Tap below to unlock audio — your device will play narrations as you walk.
        </Text>
        <TouchableOpacity style={styles.button} onPress={handleUnlockAndJoin}>
          <Text style={styles.buttonText}>🎧 Start Listening</Text>
        </TouchableOpacity>
        <Text style={styles.note}>Keep this page open while on the tour.</Text>
      </View>
    );
  }

  if (phase === "listening") {
    return (
      <View style={styles.container}>
        <Text style={styles.logo}>Roam</Text>
        <Text style={styles.city}>{sessionInfo?.city}</Text>

        <View style={styles.listeningContainer}>
          {/* Now Playing panel */}
          {hostPaused ? (
            <View style={styles.pausedBanner}>
              <Text style={styles.pausedBannerText}>Host has paused — standing by</Text>
            </View>
          ) : nowPlaying ? (
            <View style={styles.nowPlaying}>
              <Text style={styles.nowPlayingLabel}>Now playing</Text>
              <Text style={styles.nowPlayingTitle}>{nowPlaying.poi_name}</Text>
              {nowPlaying.category_name && (
                <Text style={styles.nowPlayingCategory}>{nowPlaying.category_name}</Text>
              )}
              {nowPlaying.poi_description && (
                <Text style={styles.nowPlayingDescription}>{nowPlaying.poi_description}</Text>
              )}
            </View>
          ) : (
            <View style={styles.nowPlaying}>
              <Text style={styles.nowPlayingLabel}>Waiting for next stop…</Text>
            </View>
          )}

          {/* Live transcript feed */}
          <Text style={styles.transcriptHeader}>Tour stops</Text>
          <ScrollView style={styles.transcriptScroll}>
            {transcript.map((card, i) => (
              <View key={i} style={styles.transcriptCard}>
                <Text style={styles.transcriptCardName}>{card.poi_name}</Text>
                {card.category_name && (
                  <Text style={styles.transcriptCardMeta}>{card.category_name}</Text>
                )}
                <Text style={styles.transcriptCardTime}>
                  {new Date(card.received_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
            ))}
            {transcript.length === 0 && (
              <Text style={styles.transcriptEmpty}>Stops will appear here as the tour progresses.</Text>
            )}
          </ScrollView>
        </View>

        <Text style={styles.note}>Keep this page open and your volume up.</Text>
        {Platform.OS === "web" && (
          <Text style={styles.screenWarning}>
            ⚠️ Keep your screen on — audio pauses if your screen locks.{"\n"}
            On iPhone: Settings → Display & Brightness → Auto-Lock → Never.
          </Text>
        )}
      </View>
    );
  }

  if (phase === "ended") {
    return (
      <View style={styles.container}>
        <Text style={styles.logo}>Roam</Text>
        <Text style={styles.title}>Tour Ended</Text>
        <Text style={styles.subtitle}>
          Thanks for joining! Want your own AI tour guide?
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            if (Platform.OS === "web") {
              // Deep link to app store
              window.location.href = "https://roamapp.co/download";
            }
          }}
        >
          <Text style={styles.buttonText}>Download Roam</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  logo: {
    color: "#e8c547",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 4,
    marginBottom: 32,
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    color: "#888",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  codeInput: {
    backgroundColor: "#2a2a3e",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#3a3a5e",
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 8,
    textAlign: "center",
    paddingHorizontal: 24,
    paddingVertical: 16,
    width: "100%",
    maxWidth: 280,
    marginBottom: 16,
  },
  error: {
    color: "#ff6b6b",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
  button: {
    backgroundColor: "#e8c547",
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 16,
    alignItems: "center",
    width: "100%",
    maxWidth: 280,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: "#1a1a2e",
    fontSize: 17,
    fontWeight: "800",
  },
  note: {
    color: "#555",
    fontSize: 13,
    textAlign: "center",
    marginTop: 24,
    lineHeight: 18,
  },
  city: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 32,
  },
  narrationCard: {
    backgroundColor: "#2a2a3e",
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#e8c547",
    padding: 28,
    alignItems: "center",
    width: "100%",
    maxWidth: 320,
    marginBottom: 24,
  },
  narrationLabel: {
    color: "#aaa",
    fontSize: 13,
    marginBottom: 6,
  },
  narrationName: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  waitingCard: {
    backgroundColor: "#2a2a3e",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#3a3a5e",
    padding: 28,
    alignItems: "center",
    width: "100%",
    maxWidth: 320,
    marginBottom: 24,
  },
  waitingDot: {
    color: "#3a3a5e",
    fontSize: 24,
    marginBottom: 12,
  },
  waitingText: {
    color: "#aaa",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 6,
  },
  waitingSubtext: {
    color: "#555",
    fontSize: 13,
    textAlign: "center",
  },
  screenWarning: {
    color: "#e87c47",
    fontSize: 12,
    textAlign: "center",
    marginTop: 16,
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  listeningContainer: { flex: 1 },
  pausedBanner: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
  },
  pausedBannerText: { color: "#888", fontSize: 14, fontStyle: "italic" },
  nowPlaying: {
    backgroundColor: "#1a2a1a",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: "#4a7c4a",
  },
  nowPlayingLabel: {
    color: "#7ac47a",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  nowPlayingTitle: { color: "#fff", fontSize: 20, fontWeight: "700", marginBottom: 4 },
  nowPlayingCategory: { color: "#7ac47a", fontSize: 13, marginBottom: 6 },
  nowPlayingDescription: { color: "#aaa", fontSize: 14, lineHeight: 20 },
  transcriptHeader: {
    color: "#666",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
  },
  transcriptScroll: { flex: 1 },
  transcriptCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a2e",
    gap: 8,
  },
  transcriptCardName: { flex: 1, color: "#ccc", fontSize: 14, fontWeight: "600" },
  transcriptCardMeta: { color: "#555", fontSize: 12 },
  transcriptCardTime: { color: "#444", fontSize: 11 },
  transcriptEmpty: {
    color: "#555",
    fontSize: 14,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 20,
  },
});
