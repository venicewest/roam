// services/storage.ts
// Supabase Storage helpers for TTS audio cache.
import { supabase } from "./supabase";
import type { TtsProvider } from "./tts";

const BUCKET = "poi-audio";
const SIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes (group tour broadcast window)

type CachedAudio = {
  audioUrl: string;
  durationSeconds: number | null;
  provider: TtsProvider;
};

export const storageService = {
  /** Check Supabase Storage for a cached audio file; return signed URL if found. */
  async getCachedAudio(
    poiId: string,
    provider: TtsProvider,
    voiceId: string,
  ): Promise<CachedAudio | null> {
    const { data: cacheRow } = await supabase
      .from("poi_audio_cache")
      .select("storage_path, duration_seconds")
      .eq("poi_id", poiId)
      .eq("voice_provider", provider)
      .eq("voice_id", voiceId)
      .single();

    if (!cacheRow) return null;

    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(cacheRow.storage_path, SIGNED_URL_EXPIRY_SECONDS);

    if (!signed?.signedUrl) return null;

    return {
      audioUrl: signed.signedUrl,
      durationSeconds: cacheRow.duration_seconds,
      provider,
    };
  },

  /** Upload generated audio and record in poi_audio_cache. */
  async uploadAudio(
    storagePath: string,
    audioBytes: ArrayBuffer,
    poiId: string,
    provider: TtsProvider,
  ): Promise<{ signedUrl: string } | null> {
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, audioBytes, {
        contentType: "audio/mpeg",
        upsert: true,
      });

    if (uploadError) {
      console.error("[Storage] Upload failed:", uploadError.message);
      return null;
    }

    // Record in cache table
    await supabase.from("poi_audio_cache").upsert(
      {
        poi_id: poiId,
        voice_provider: provider,
        voice_id: storagePath.split("/").pop() ?? "default",
        storage_path: storagePath,
      },
      { onConflict: "poi_id,voice_provider,voice_id" },
    );

    // Return signed URL
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

    return signed?.signedUrl ? { signedUrl: signed.signedUrl } : null;
  },

  /** Get a signed URL for an existing storage path (used for group tour broadcasts). */
  async getSignedUrl(storagePath: string): Promise<string | null> {
    const { data } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);
    return data?.signedUrl ?? null;
  },
};
