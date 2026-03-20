// hooks/useTourSession.ts
// Session lifecycle: start, heartbeat, end.
import { useCallback, useEffect, useRef } from "react";
import { api } from "../services/api";
import { supabase } from "../services/supabase";
import { useSessionStore } from "../stores/sessionStore";
import { useUserStore } from "../stores/userStore";

const HEARTBEAT_INTERVAL_MS = 60_000; // 60s

export function useTourSession() {
  const { session, isActive, startSession, endSession } = useSessionStore();
  const { refreshBalance } = useUserStore();
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTour = useCallback(
    async (params: {
      interest_category_ids: number[];
      city: string;
      is_group_tour: boolean;
    }): Promise<{ session_id: string; join_code: string | null } | null> => {
      const res = await api.startTourSession(params);
      if (!res.success || !res.data) return null;

      // Fetch full session row — store minimal info locally
      startSession({
        id: res.data.session_id,
        host_user_id: "",
        join_code: res.data.join_code,
        is_group_tour: params.is_group_tour,
        guest_count: 0,
        interest_category_ids: params.interest_category_ids,
        city: params.city,
        credits_charged: 0,
        billing_status: "open",
        status: "active",
        started_at: new Date().toISOString(),
        ended_at: null,
        route_polyline: null,
        total_distance_meters: null,
      });

      return res.data;
    },
    [startSession],
  );

  const endTour = useCallback(
    async (params?: {
      route_polyline?: string;
      total_distance_meters?: number;
    }): Promise<{ charged: boolean; credits_used: number } | null> => {
      if (!session) return null;

      clearHeartbeat();

      const res = await api.endTourSession({
        session_id: session.id,
        ...params,
      });

      endSession();
      await refreshBalance();

      return res.success ? (res.data ?? null) : null;
    },
    [session, endSession, refreshBalance],
  );

  // Heartbeat keeps session alive — server-side cron marks sessions as abandoned
  // if last_heartbeat goes stale for >20 min.
  const startHeartbeat = useCallback(() => {
    clearHeartbeat();
    heartbeatTimer.current = setInterval(async () => {
      if (!session) return;
      await supabase
        .from("tour_sessions")
        .update({ last_heartbeat: new Date().toISOString() })
        .eq("id", session.id);
    }, HEARTBEAT_INTERVAL_MS);
  }, [session]);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      startHeartbeat();
    } else {
      clearHeartbeat();
    }
    return clearHeartbeat;
  }, [isActive]);

  return {
    session,
    isActive,
    startTour,
    endTour,
    pauseHeartbeat: clearHeartbeat,
    resumeHeartbeat: startHeartbeat,
  };
}
