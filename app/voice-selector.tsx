// app/voice-selector.tsx
import { Audio } from "expo-av";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { ELEVENLABS_VOICES, DEFAULT_VOICE_ID, Voice } from "../constants/voices";
import { useUserStore } from "../stores/userStore";

const SAMPLE_TEXT =
  "Welcome to Roam. I'll be your personal guide, bringing history and culture to life as you explore.";

export default function VoiceSelectorScreen() {
  const { profile, saveVoice } = useUserStore();
  const [selectedId, setSelectedId] = useState<string>(
    profile?.preferred_voice_id ?? DEFAULT_VOICE_ID,
  );
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);

  const stopCurrentSound = async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    setPlayingId(null);
  };

  const handlePlaySample = async (voice: Voice) => {
    if (playingId === voice.id) {
      await stopCurrentSound();
      return;
    }

    await stopCurrentSound();

    const apiKey = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
    if (!apiKey) {
      Alert.alert("Error", "ElevenLabs API key not configured.");
      return;
    }

    setPlayingId(voice.id);

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice.id}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: SAMPLE_TEXT,
            model_id: "eleven_turbo_v2_5",
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        },
      );

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`ElevenLabs ${res.status}: ${body}`);
      }

      // Convert response to base64 for expo-av
      const buffer = await res.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const uri = `data:audio/mpeg;base64,${base64}`;

      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true },
      );
      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          soundRef.current = null;
          setPlayingId(null);
        }
      });
    } catch (err: any) {
      console.error("[VoiceSelector] playback error:", err);
      setPlayingId(null);
      Alert.alert("Playback failed", err?.message ?? "Could not play sample.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await stopCurrentSound();
      await saveVoice(selectedId);
      router.back();
    } catch (err: any) {
      Alert.alert("Save failed", err?.message ?? "Could not save voice.");
    } finally {
      setSaving(false);
    }
  };

  const british = ELEVENLABS_VOICES.filter((v) => v.accent === "British");
  const american = ELEVENLABS_VOICES.filter((v) => v.accent === "American");

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { stopCurrentSound(); router.back(); }}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Narration Voice</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#e8c547" />
          ) : (
            <Text style={styles.save}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.hint}>
          Tap a voice to select it. Tap the play button to hear a sample.
        </Text>

        <SectionHeader label="British" />
        {british.map((voice) => (
          <VoiceRow
            key={voice.id}
            voice={voice}
            selected={selectedId === voice.id}
            playing={playingId === voice.id}
            onSelect={() => setSelectedId(voice.id)}
            onPlay={() => handlePlaySample(voice)}
          />
        ))}

        <SectionHeader label="American" />
        {american.map((voice) => (
          <VoiceRow
            key={voice.id}
            voice={voice}
            selected={selectedId === voice.id}
            playing={playingId === voice.id}
            onSelect={() => setSelectedId(voice.id)}
            onPlay={() => handlePlaySample(voice)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

function VoiceRow({
  voice,
  selected,
  playing,
  onSelect,
  onPlay,
}: {
  voice: Voice;
  selected: boolean;
  playing: boolean;
  onSelect: () => void;
  onPlay: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, selected && styles.rowSelected]}
      onPress={onSelect}
      activeOpacity={0.7}
    >
      <View style={styles.rowLeft}>
        <View style={[styles.radio, selected && styles.radioSelected]}>
          {selected && <View style={styles.radioDot} />}
        </View>
        <View>
          <Text style={styles.voiceName}>{voice.name}</Text>
          <Text style={styles.voiceMeta}>
            {voice.gender === "female" ? "Female" : "Male"}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.playButton} onPress={onPlay}>
        {playing ? (
          <ActivityIndicator size="small" color="#1a1a2e" />
        ) : (
          <Text style={styles.playIcon}>▶</Text>
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a3e",
  },
  title: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  cancel: {
    color: "#aaa",
    fontSize: 16,
  },
  save: {
    color: "#e8c547",
    fontSize: 16,
    fontWeight: "700",
  },
  scroll: {
    padding: 20,
    paddingBottom: 48,
  },
  hint: {
    color: "#888",
    fontSize: 13,
    marginBottom: 24,
    lineHeight: 18,
  },
  sectionHeader: {
    marginBottom: 8,
    marginTop: 8,
  },
  sectionLabel: {
    color: "#666",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  row: {
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
  rowSelected: {
    borderColor: "#e8c547",
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#555",
    justifyContent: "center",
    alignItems: "center",
  },
  radioSelected: {
    borderColor: "#e8c547",
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#e8c547",
  },
  voiceName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  voiceMeta: {
    color: "#888",
    fontSize: 12,
    marginTop: 2,
  },
  playButton: {
    backgroundColor: "#e8c547",
    borderRadius: 20,
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  playIcon: {
    color: "#1a1a2e",
    fontSize: 13,
    marginLeft: 2,
  },
});
