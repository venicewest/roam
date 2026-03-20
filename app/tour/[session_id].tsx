// app/tour/[session_id].tsx
// Full-screen active tour: GPS + scan loop + TTS narration + live transcript.
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GroupBadge } from "../../components/tour/GroupBadge";
import { NarrationStrip } from "../../components/tour/NarrationStrip";
import { PoiDrawer } from "../../components/tour/PoiDrawer";
import { TourMap } from "../../components/tour/TourMap";
import { BottomSheet } from "../../components/shared/BottomSheet";
import { useAudioPlayer } from "../../hooks/useAudioPlayer";
import { useGroupTour } from "../../hooks/useGroupTour";
import { useLocation } from "../../hooks/useLocation";
import { usePoiScanner } from "../../hooks/usePoiScanner";
import { useTourSession } from "../../hooks/useTourSession";
import { ACCESS_COUNT_FLUSH_INTERVAL_MS } from "../../constants/config";
import { api } from "../../services/api";
import { ttsService } from "../../services/tts";
import { supabase } from "../../services/supabase";
import { useSessionStore, type QueuedPoi } from "../../stores/sessionStore";
import { useUserStore } from "../../stores/userStore";
import { usePoiStore } from "../../stores/poiStore";

export default function TourScreen() {
  const { session_id } = useLocalSearchParams<{ session_id: string }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [liveGuestCount, setLiveGuestCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [followupRequestedIds, setFollowupRequestedIds] = useState<Set<string>>(new Set());
  const [currentNarrative, setCurrentNarrative] = useState<string | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);
  const followupAudioRef = useRef<string | null>(null);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    current: location,
    rollingSpeedMs,
    startTracking,
    stopTracking,
  } = useLocation();

  const {
    session,
    currentPoi,
    pendingNarrationEvents,
    poiStates,
    queue,
    beginNarrating,
    completeNarration,
    addNarrationEvent,
    flushNarrationEvents,
    recordNarrationTime,
  } = useSessionStore();

  const { tile } = usePoiStore();
  const { endTour, pauseHeartbeat, resumeHeartbeat } = useTourSession();

  const { broadcastNarration, broadcastPause, broadcastResume, broadcastReplay } = useGroupTour({
    onGuestJoined: setLiveGuestCount,
  });

  const { adaptiveLock, setAdaptiveLock } = useUserStore();

  const { playAudio, stopPlayback, currentPoiId, isPaused: audioIsPaused, pause, resume, replay, canPlay } = useAudioPlayer(
    (completedPoiId) => {
      const poi = usePoiStore.getState().getPoiById(completedPoiId);
      addNarrationEvent({
        poi_id: completedPoiId,
        narrated_at: new Date().toISOString(),
        trigger_distance_meters: 30,
        was_ai_generated: (poi?.tier ?? 1) === 2,
      });
      completeNarration(completedPoiId);

      // Play queued follow-up audio if any
      const pending = followupAudioRef.current;
      if (pending) {
        followupAudioRef.current = null;
        setTimeout(() => playAudio(pending, completedPoiId + '-followup'), 500);
      }
    },
  );

  const handlePoiReady = useCallback(
    async (poi: QueuedPoi) => {
      // Fetch full narrative from DB — PoiTileItem is lightweight and omits it
      const { data: full } = await supabase
        .from("pois")
        .select("narrative")
        .eq("id", poi.id)
        .single();

      let narrative = full?.narrative;

      // If placeholder, synthesize a real AI narrative first
      const isPlaceholder =
        !narrative || narrative.trim().endsWith("is a point of interest in New Orleans.") ||
        /^.+ is a point of interest in .+\.$/.test(narrative.trim());

      const effectiveDepth = !adaptiveLock && rollingSpeedMs > 1.2
        ? 'quick'
        : (session?.depth_tier ?? 'full');

      if (isPlaceholder) {
        const result = await api.synthesizePoi({ poi_id: poi.id, depth_tier: effectiveDepth });
        if (result.success && result.data?.narrative) {
          narrative = result.data.narrative;
        } else {
          // Synthesis failed — skip this POI silently
          completeNarration(poi.id);
          return;
        }
      }

      if (!narrative) {
        completeNarration(poi.id);
        return;
      }

      beginNarrating(poi.id);
      recordNarrationTime();

      const hasPreferredVoice = !!useUserStore.getState().profile?.preferred_voice_id;
      const ttsResult = await ttsService.getAudio(
        poi.id,
        narrative,
        hasPreferredVoice ? "elevenlabs" : "google",
      );

      if (!ttsResult) {
        completeNarration(poi.id);
        return;
      }

      // Store narrative text and audio URL for NarrationStrip display
      setCurrentNarrative(narrative ?? null);
      currentAudioUrlRef.current = ttsResult.audioUrl;

      // Broadcast to group tour guests before playing locally
      if (session?.is_group_tour) {
        const firstSentence = narrative?.split('.')[0] ?? '';
        await broadcastNarration(poi.id, ttsResult.audioUrl, poi.name ?? '', firstSentence);
      }

      // Safety timeout: if audio doesn't complete within 3 min, unstick the state
      const safetyTimer = setTimeout(() => completeNarration(poi.id), 180_000);
      await playAudio(ttsResult.audioUrl, poi.id);
      clearTimeout(safetyTimer);
    },
    [beginNarrating, completeNarration, recordNarrationTime, playAudio, broadcastNarration, session?.is_group_tour, session?.depth_tier, adaptiveLock, rollingSpeedMs],
  );

  const { updateLocation, startScanner, stopScanner, suspendScanner, resumeScanner } =
    usePoiScanner({ onPoiReady: handlePoiReady });

  // Computed effective depth tier
  const effectiveDepthTier = !adaptiveLock && rollingSpeedMs > 1.2
    ? 'quick'
    : (session?.depth_tier ?? 'full');
  const isAdaptive = !adaptiveLock && rollingSpeedMs > 1.2;

  // Feed location into scanner — don't pause on stationary (fake GPS & slow walkers report speed=0)
  useEffect(() => {
    if (location) {
      updateLocation(location);
    }
  }, [location]);

  // Start scanner on first GPS fix
  useEffect(() => {
    if (location && session) {
      startScanner(location.lat, location.lon);
    }
  }, [!!location, !!session]);

  // Mount: start GPS tracking and narration flush timer
  useEffect(() => {
    startTracking();

    flushTimer.current = setInterval(async () => {
      const events = flushNarrationEvents();
      if (events.length > 0 && session) {
        await api.logPoiNarrations({ session_id: session.id, events });
      }
    }, ACCESS_COUNT_FLUSH_INTERVAL_MS);

    return () => {
      stopTracking();
      stopScanner();
      stopPlayback();
      if (flushTimer.current) clearInterval(flushTimer.current);
    };
  }, []);

  // Android back button interception
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      confirmEndTour();
      return true;
    });
    return () => sub.remove();
  }, [session]);

  const confirmEndTour = () => {
    Alert.alert(
      "End tour?",
      "Your tour will be ended and credits will be charged.",
      [
        { text: "Keep walking", style: "cancel" },
        { text: "End tour", style: "destructive", onPress: doEndTour },
      ],
    );
  };

  const doEndTour = async () => {
    // Final narration flush
    const events = flushNarrationEvents();
    if (events.length > 0 && session) {
      await api.logPoiNarrations({ session_id: session.id, events });
    }
    await stopPlayback();
    stopScanner();
    await stopTracking();
    await endTour();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.replace(`/transcript/${session_id}` as any);
  };

  const handlePause = useCallback(async () => {
    if (isPaused) {
      await resume();
      resumeScanner();
      resumeHeartbeat();
      setIsPaused(false);
      if (session?.is_group_tour) broadcastResume();
    } else {
      await pause();
      suspendScanner();
      pauseHeartbeat();
      setIsPaused(true);
      if (session?.is_group_tour) broadcastPause();
    }
  }, [isPaused, pause, resume, suspendScanner, resumeScanner, pauseHeartbeat, resumeHeartbeat, session?.is_group_tour, broadcastPause, broadcastResume]);

  const handleReplay = useCallback(async () => {
    await replay();
    if (session?.is_group_tour && currentPoi && currentAudioUrlRef.current) {
      broadcastReplay(currentPoi.id, currentAudioUrlRef.current, currentPoi.name ?? '');
    }
  }, [replay, session?.is_group_tour, currentPoi, broadcastReplay]);

  const handleSkip = useCallback(() => {
    if (!currentPoi) return;
    useSessionStore.getState().skipPoi(currentPoi.id);
    stopPlayback();
  }, [currentPoi, stopPlayback]);

  const handleMore = useCallback(async () => {
    if (!currentPoi || !session) return;
    setFollowupRequestedIds((prev) => new Set(prev).add(currentPoi.id));
    const depthTier = session.depth_tier ?? 'full';
    const result = await api.getPoiFollowup({ poi_id: currentPoi.id, depth_tier: depthTier });
    if (result.success && result.data?.audio_url) {
      followupAudioRef.current = result.data.audio_url;
    }
  }, [currentPoi, session]);

  // canPlay is a function — call it to get boolean for isInGap
  const isInGap = !canPlay();

  return (
    <View style={styles.container}>
      {/* Map area — flex fills available space above narration strip */}
      <View style={styles.mapArea}>
        <TourMap
          location={location}
          pois={tile}
          currentPoiId={currentPoiId}
          poiStates={poiStates}
          queue={queue}
        />

        {/* Depth tier badge overlay — top left */}
        <TouchableOpacity
          style={styles.depthBadge}
          onPress={() => setAdaptiveLock(!adaptiveLock)}
        >
          <Text style={[styles.depthBadgeText, isPaused && styles.depthBadgeDimmed]}>
            {effectiveDepthTier.charAt(0).toUpperCase() + effectiveDepthTier.slice(1)}
            {isAdaptive ? ' · Auto' : ''}
          </Text>
        </TouchableOpacity>

        {/* Transcript toggle — top right */}
        <TouchableOpacity
          style={styles.transcriptToggle}
          onPress={() => setDrawerOpen(true)}
        >
          <Text style={styles.transcriptToggleText}>
            {pendingNarrationEvents.length > 0
              ? `${pendingNarrationEvents.length} stop${pendingNarrationEvents.length !== 1 ? "s" : ""}`
              : "≡"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Header bar — slim, absolute positioned over map */}
      <SafeAreaView style={styles.topBar} pointerEvents="box-none">
        <Text style={styles.cityText}>{session?.city ?? ''}</Text>
        <TouchableOpacity style={styles.endButton} onPress={confirmEndTour}>
          <Text style={styles.endButtonText}>End Tour</Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Group badge — if applicable */}
      {session?.is_group_tour && session.join_code && (
        <GroupBadge
          guestCount={liveGuestCount || session.guest_count}
          joinCode={session.join_code}
        />
      )}

      {/* Narration strip — fixed bottom */}
      <NarrationStrip
        poi={currentPoi}
        narrative={currentNarrative}
        isPaused={isPaused}
        isInGap={isInGap}
        followupRequested={currentPoi ? followupRequestedIds.has(currentPoi.id) : false}
        onReplay={handleReplay}
        onMore={handleMore}
        onPause={handlePause}
        onSkip={handleSkip}
      />

      {/* Transcript bottom sheet */}
      <BottomSheet visible={drawerOpen} onClose={() => setDrawerOpen(false)} snapHeight={450}>
        <Text style={styles.drawerTitle}>Tour transcript</Text>
        <PoiDrawer events={pendingNarrationEvents} />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d' },
  mapArea: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 8,
  },
  cityText: { color: '#ccc', fontSize: 14 },
  endButton: {
    backgroundColor: '#1a1a2edd',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#ff6b6b',
  },
  endButtonText: { color: '#ff6b6b', fontWeight: '700', fontSize: 14 },
  depthBadge: {
    position: 'absolute',
    top: 52,
    left: 12,
    backgroundColor: '#00000088',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#333',
  },
  depthBadgeText: { color: '#e8a44a', fontSize: 12, fontWeight: '600' },
  depthBadgeDimmed: { color: '#555' },
  transcriptToggle: {
    position: 'absolute',
    top: 52,
    right: 12,
    backgroundColor: '#00000088',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#333',
  },
  transcriptToggleText: { color: '#aaa', fontSize: 16 },
  drawerTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 16 },
});
