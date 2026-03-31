// services/tts.ts
// Google TTS (Tier 1) + ElevenLabs (Tier 2) abstraction.
// Checks Supabase Storage cache before generating new audio.
import { storageService } from "./storage";
import { DEFAULT_VOICE_ID } from "../constants/voices";
import { useUserStore } from "../stores/userStore";

const GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

const GOOGLE_VOICE_ID = "en-US-Neural2-D";

export type TtsProvider = "google" | "elevenlabs";

export type TtsResult = {
  audioUrl: string; // signed Supabase Storage URL
  durationSeconds: number | null;
  provider: TtsProvider;
  fromCache: boolean;
};

export const ttsService = {
  /**
   * Get audio for a POI narrative.
   * Checks cache first; generates and caches on miss.
   */
  async getAudio(
    poiId: string,
    narrative: string,
    provider: TtsProvider = "google",
  ): Promise<TtsResult | null> {
    // 1. Check cache
    const elevenLabsVoiceId =
      useUserStore.getState().profile?.preferred_voice_id ?? DEFAULT_VOICE_ID;
    const voiceId = provider === "google" ? GOOGLE_VOICE_ID : elevenLabsVoiceId;
    const cached = await storageService.getCachedAudio(poiId, provider, voiceId);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    // 2. Generate audio
    let audioBytes: ArrayBuffer | null = null;
    try {
      if (provider === "google") {
        audioBytes = await generateGoogleTts(narrative);
      } else {
        audioBytes = await generateElevenLabsTts(narrative, voiceId);
      }
    } catch (err) {
      console.error(`[TTS] ${provider} generation failed:`, err);
      return null;
    }

    if (!audioBytes) return null;
    const storagePath = `audio/${poiId}/${provider}_${voiceId}.mp3`;
    const uploaded = await storageService.uploadAudio(
      storagePath,
      audioBytes,
      poiId,
      provider,
    );
    if (!uploaded) return null;

    return {
      audioUrl: uploaded.signedUrl,
      durationSeconds: null, // set by expo-av after playback starts
      provider,
      fromCache: false,
    };
  },
};

async function generateGoogleTts(text: string): Promise<ArrayBuffer | null> {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_TTS_API_KEY;
  if (!apiKey) {
    console.warn("[TTS] EXPO_PUBLIC_GOOGLE_TTS_API_KEY not set");
    return null;
  }

  const res = await fetch(`${GOOGLE_TTS_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "en-US", name: GOOGLE_VOICE_ID },
      audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
    }),
  });

  if (!res.ok) {
    console.error("[TTS] Google TTS error:", res.status, await res.text());
    return null;
  }

  const json = await res.json();
  const base64Audio: string = json.audioContent;
  return base64ToArrayBuffer(base64Audio);
}

async function generateElevenLabsTts(
  text: string,
  voiceId: string,
): Promise<ArrayBuffer | null> {
  const apiKey = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.warn("[TTS] EXPO_PUBLIC_ELEVENLABS_API_KEY not set");
    return null;
  }

  const res = await fetch(`${ELEVENLABS_URL}/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    console.error("[TTS] ElevenLabs error:", res.status, await res.text());
    return null;
  }

  return res.arrayBuffer();
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
