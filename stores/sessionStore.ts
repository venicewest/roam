// stores/sessionStore.ts
// Active tour state + POI state machine
import { create } from "zustand/react";
import type { PoiTileItem, TourSession } from "../services/supabase";

export type PoiState =
  | "UNVISITED"
  | "QUEUED"
  | "NARRATING"
  | "COMPLETED"
  | "SKIPPED";

export type NarrationEvent = {
  poi_id: string;
  narrated_at: string;
  trigger_distance_meters: number;
  was_ai_generated: boolean;
  audio_duration_seconds?: number;
  session_poi_id?: string; // set after log-poi-narration flush
};

export type QueuedPoi = PoiTileItem & {
  state: PoiState;
  priority: number;
  audio_url?: string;
  audio_duration_seconds?: number;
  narrative?: string;
  session_poi_id?: string;
};

type SessionStore = {
  // Active session
  session: TourSession | null;
  isActive: boolean;

  // POI state machine
  poiStates: Record<string, PoiState>; // poi_id → state
  queue: QueuedPoi[]; // ordered narration queue
  currentPoi: QueuedPoi | null; // POI currently narrating

  // Narration event buffer (flushed every 60s to log-poi-narration EF)
  pendingNarrationEvents: NarrationEvent[];

  // Recent narration timestamps for rate limiting
  recentNarrationTimes: number[];

  // Actions
  startSession: (session: TourSession) => void;
  endSession: () => void;

  setPoisVisited: (poiIds: string[]) => void;
  queuePoi: (poi: QueuedPoi) => void;
  setPoiAudio: (poiId: string, audioUrl: string, durationSeconds: number) => void;
  beginNarrating: (poiId: string) => void;
  completeNarration: (poiId: string, sessionPoiId?: string) => void;
  skipPoi: (poiId: string) => void;
  resetSkipped: () => void;

  addNarrationEvent: (event: NarrationEvent) => void;
  flushNarrationEvents: () => NarrationEvent[];

  recordNarrationTime: () => void;
  canNarrateNow: (minGapMs: number, maxPer2Min: number) => boolean;
};

export const useSessionStore = create<SessionStore>((set, get) => ({
  session: null,
  isActive: false,
  poiStates: {},
  queue: [],
  currentPoi: null,
  pendingNarrationEvents: [],
  recentNarrationTimes: [],

  startSession: (session) =>
    set({
      session,
      isActive: true,
      poiStates: {},
      queue: [],
      currentPoi: null,
      pendingNarrationEvents: [],
      recentNarrationTimes: [],
    }),

  endSession: () =>
    set({
      session: null,
      isActive: false,
      poiStates: {},
      queue: [],
      currentPoi: null,
      pendingNarrationEvents: [],
      recentNarrationTimes: [],
    }),

  setPoisVisited: (poiIds) => {
    const updates: Record<string, PoiState> = {};
    poiIds.forEach((id) => {
      updates[id] = "COMPLETED";
    });
    set((s) => ({ poiStates: { ...s.poiStates, ...updates } }));
  },

  queuePoi: (poi) => {
    set((s) => {
      if (s.poiStates[poi.id] && s.poiStates[poi.id] !== "UNVISITED") {
        return s; // already queued/completed
      }
      const newQueue = [...s.queue, { ...poi, state: "QUEUED" as PoiState }]
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 5); // max queue depth
      return {
        queue: newQueue,
        poiStates: { ...s.poiStates, [poi.id]: "QUEUED" },
      };
    });
  },

  setPoiAudio: (poiId, audioUrl, durationSeconds) => {
    set((s) => ({
      queue: s.queue.map((p) =>
        p.id === poiId ? { ...p, audio_url: audioUrl, audio_duration_seconds: durationSeconds } : p,
      ),
    }));
  },

  beginNarrating: (poiId) => {
    set((s) => {
      const poi = s.queue.find((p) => p.id === poiId) ?? null;
      return {
        currentPoi: poi,
        queue: s.queue.filter((p) => p.id !== poiId),
        poiStates: { ...s.poiStates, [poiId]: "NARRATING" },
      };
    });
  },

  completeNarration: (poiId, sessionPoiId) => {
    set((s) => ({
      currentPoi: null,
      poiStates: { ...s.poiStates, [poiId]: "COMPLETED" },
      queue: s.queue.map((p) =>
        p.id === poiId ? { ...p, session_poi_id: sessionPoiId } : p,
      ),
    }));
  },

  skipPoi: (poiId) => {
    set((s) => ({
      queue: s.queue.filter((p) => p.id !== poiId),
      poiStates: { ...s.poiStates, [poiId]: "SKIPPED" },
    }));
  },

  resetSkipped: () => {
    set((s) => {
      const updated = { ...s.poiStates };
      Object.keys(updated).forEach((id) => {
        if (updated[id] === "SKIPPED") updated[id] = "UNVISITED";
      });
      return { poiStates: updated };
    });
  },

  addNarrationEvent: (event) => {
    set((s) => ({
      pendingNarrationEvents: [...s.pendingNarrationEvents, event],
    }));
  },

  flushNarrationEvents: () => {
    const events = get().pendingNarrationEvents;
    set({ pendingNarrationEvents: [] });
    return events;
  },

  recordNarrationTime: () => {
    const now = Date.now();
    set((s) => ({
      recentNarrationTimes: [...s.recentNarrationTimes, now].filter(
        (t) => now - t < 120_000, // keep only last 2 min
      ),
    }));
  },

  canNarrateNow: (minGapMs, maxPer2Min) => {
    const { recentNarrationTimes, currentPoi } = get();
    if (currentPoi) return false; // already narrating

    const now = Date.now();
    const last = recentNarrationTimes[recentNarrationTimes.length - 1] ?? 0;
    if (now - last < minGapMs) return false;

    const recent2Min = recentNarrationTimes.filter((t) => now - t < 120_000);
    if (recent2Min.length >= maxPer2Min) return false;

    return true;
  },
}));
