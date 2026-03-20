// hooks/useAudioPlayer.ts
// TTS audio playback queue with minimum gap enforcement.
import { Audio, AVPlaybackStatus } from "expo-av";
import { useCallback, useEffect, useRef, useState } from "react";
import { MIN_GAP_BETWEEN_NARRATIONS_MS } from "../constants/config";

type PlayerState = {
  isPlaying: boolean;
  currentPoiId: string | null;
  durationSeconds: number | null;
};

export function useAudioPlayer(onNarrationComplete?: (poiId: string) => void) {
  const [state, setState] = useState<PlayerState>({
    isPlaying: false,
    currentPoiId: null,
    durationSeconds: null,
  });

  const soundRef = useRef<Audio.Sound | null>(null);
  const lastPlayedAt = useRef<number>(0);
  const currentPoiRef = useRef<string | null>(null);
  const pausedPositionMs = useRef<number>(0);
  const currentAudioUrl = useRef<string | null>(null);
  const lastPoiIdRef = useRef<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const canPlay = useCallback(
    (gapMs = MIN_GAP_BETWEEN_NARRATIONS_MS): boolean => {
      return Date.now() - lastPlayedAt.current >= gapMs;
    },
    [],
  );

  const playAudio = useCallback(
    async (audioUrl: string, poiId: string): Promise<void> => {
      currentAudioUrl.current = audioUrl;
      setIsPaused(false);

      // Stop any existing playback
      if (soundRef.current) {
        await soundRef.current.stopAsync().catch(() => {});
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }

      currentPoiRef.current = poiId;
      lastPoiIdRef.current = poiId;
      setState({ isPlaying: true, currentPoiId: poiId, durationSeconds: null });

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: true },
        (status: AVPlaybackStatus) => {
          if (!status.isLoaded) return;

          if (status.didJustFinish) {
            lastPlayedAt.current = Date.now();
            setState({
              isPlaying: false,
              currentPoiId: null,
              durationSeconds: null,
            });
            const completedId = currentPoiRef.current;
            currentPoiRef.current = null;
            if (completedId) onNarrationComplete?.(completedId);
          }

          if (status.durationMillis && !state.durationSeconds) {
            setState((s) => ({
              ...s,
              durationSeconds: status.durationMillis! / 1000,
            }));
          }
        },
      );

      soundRef.current = sound;
    },
    [onNarrationComplete],
  );

  const stopPlayback = useCallback(async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync().catch(() => {});
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    currentPoiRef.current = null;
    setState({ isPlaying: false, currentPoiId: null, durationSeconds: null });
  }, []);

  const replay = useCallback(async () => {
    if (!soundRef.current) return;
    await soundRef.current.playFromPositionAsync(0);
    setIsPaused(false);
  }, []);

  const pause = useCallback(async () => {
    if (!soundRef.current) return;
    const status = await soundRef.current.getStatusAsync();
    if (status.isLoaded) {
      pausedPositionMs.current = status.positionMillis ?? 0;
    }
    await soundRef.current.pauseAsync();
    setIsPaused(true);
  }, []);

  const resume = useCallback(async () => {
    if (soundRef.current) {
      await soundRef.current.playFromPositionAsync(pausedPositionMs.current);
      setIsPaused(false);
      return;
    }
    // OS reclaimed the audio session — recreate from cached URL
    const url = currentAudioUrl.current;
    const poiId = lastPoiIdRef.current;
    if (!url || !poiId) return;
    await playAudio(url, poiId);
    // Seek to stored position after recreation
    const recreated = soundRef.current as Audio.Sound | null;
    if (recreated) {
      await recreated.playFromPositionAsync(pausedPositionMs.current);
    }
    setIsPaused(false);
  }, [playAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  return {
    ...state,
    isPaused,
    canPlay,
    playAudio,
    stopPlayback,
    replay,
    pause,
    resume,
  };
}
