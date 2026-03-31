// hooks/useGroupTour.ts
// Manages the Supabase Realtime channel for a group tour.
// Host: broadcasts POI_NARRATE events when narration starts.
// Guest: subscribes to POI_NARRATE + SESSION_STATE events (handled in app/join/).
import { useCallback, useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { useSessionStore } from '../stores/sessionStore';

export type GroupTourEvent =
  | {
      event: 'POI_NARRATE';
      payload: {
        poi_id: string;
        audio_url: string;
        poi_name: string;
        poi_description?: string;
        category_name?: string;
      };
    }
  | { event: 'SESSION_STATE'; payload: { status: 'ended' | 'paused' | 'resumed'; city?: string } }
  | { event: 'GUEST_JOINED'; payload: { guest_count: number } };

type UseGroupTourOptions = {
  /** Called when guest count changes (host use) */
  onGuestJoined?: (guestCount: number) => void;
};

export function useGroupTour({ onGuestJoined }: UseGroupTourOptions = {}) {
  const { session } = useSessionStore();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const joinCode = session?.is_group_tour ? session.join_code : null;

  // Subscribe to the tour channel as host
  useEffect(() => {
    if (!joinCode) return;

    const channel = supabase.channel(`tour:${joinCode}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'GUEST_JOINED' }, ({ payload }) => {
        onGuestJoined?.(payload.guest_count);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [joinCode, onGuestJoined]);

  /** Broadcast a POI_NARRATE event to all guests */
  const broadcastNarration = useCallback(
    async (
      poiId: string,
      audioUrl: string,
      poiName: string,
      poiDescription?: string,
      categoryName?: string,
    ) => {
      if (!channelRef.current) return;
      await channelRef.current.send({
        type: 'broadcast',
        event: 'POI_NARRATE',
        payload: {
          poi_id: poiId,
          audio_url: audioUrl,
          poi_name: poiName,
          ...(poiDescription ? { poi_description: poiDescription } : {}),
          ...(categoryName ? { category_name: categoryName } : {}),
        },
      });
    },
    [],
  );

  /** Broadcast SESSION_STATE paused to all guests */
  const broadcastPause = useCallback(async () => {
    if (!channelRef.current) return;
    await channelRef.current.send({
      type: 'broadcast',
      event: 'SESSION_STATE',
      payload: { status: 'paused' },
    });
  }, []);

  /** Broadcast SESSION_STATE resumed to all guests */
  const broadcastResume = useCallback(async () => {
    if (!channelRef.current) return;
    await channelRef.current.send({
      type: 'broadcast',
      event: 'SESSION_STATE',
      payload: { status: 'resumed' },
    });
  }, []);

  /** Replay a POI narration to all guests */
  const broadcastReplay = useCallback(
    async (poiId: string, audioUrl: string, poiName: string) => {
      if (!channelRef.current) return;
      await channelRef.current.send({
        type: 'broadcast',
        event: 'POI_NARRATE',
        payload: { poi_id: poiId, audio_url: audioUrl, poi_name: poiName },
      });
    },
    [],
  );

  return { broadcastNarration, broadcastPause, broadcastResume, broadcastReplay };
}
