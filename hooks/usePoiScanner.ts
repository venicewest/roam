// hooks/usePoiScanner.ts
// 5-second scan loop: scores nearby POIs, manages the narration queue,
// detects tile edge, triggers pre-fetches, and pre-synthesizes Tier 3 POIs.
import { useCallback, useEffect, useRef } from "react";
import {
  AVG_NARRATION_SECONDS,
  MAX_NARRATIONS_PER_2_MIN,
  MAX_QUEUE_DEPTH,
  MIN_GAP_BETWEEN_NARRATIONS_MS,
  NARRATION_BUFFER_SECONDS,
  PRE_SYNTHESIS_RADIUS_METERS,
  SCAN_INTERVAL_MS,
  STATIONARY_COOLDOWN_SECONDS,
  TILE_RADIUS_METERS,
  TILE_REFRESH_THRESHOLD_METERS,
} from "../constants/config";
import { api } from "../services/api";
import type { PoiTileItem } from "../services/supabase";
import { usePoiStore } from "../stores/poiStore";
import { useSessionStore } from "../stores/sessionStore";
import type { QueuedPoi } from "../stores/sessionStore";
import {
  bearingDegrees,
  directionalScore,
  distanceMeters,
  nearTileEdge,
  poiPriority,
  triggerDistance,
} from "../utils/geo";
import type { LocationFix } from "./useLocation";

type ScannerOptions = {
  onPoiReady: (poi: QueuedPoi) => void; // called when a POI should start narrating
};

export function usePoiScanner({ onPoiReady }: ScannerOptions) {
  const { tile, tileCenterLat, tileCenterLon, setTile, setFetching, isFetching } =
    usePoiStore();
  const {
    session,
    poiStates,
    queue,
    queuePoi,
    canNarrateNow,
    resetSkipped,
  } = useSessionStore();

  const scanTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stationaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationRef = useRef<LocationFix | null>(null);
  const isFetchingRef = useRef(false);
  const runScanRef = useRef<() => void>(() => {});
  // Track POIs already sent for pre-synthesis to avoid duplicate calls
  const preSynthesizedRef = useRef<Set<string>>(new Set());

  // Call this from useLocation to keep location fresh between scans
  const updateLocation = useCallback((fix: LocationFix) => {
    locationRef.current = fix;
  }, []);

  const fetchTile = useCallback(
    async (lat: number, lon: number) => {
      if (!session || isFetchingRef.current) return;
      isFetchingRef.current = true;
      setFetching(true);

      const completedIds = Object.entries(poiStates)
        .filter(([, s]) => s === "COMPLETED")
        .map(([id]) => id);

      const res = await api.getPoiTile({
        lat,
        lon,
        radius_meters: TILE_RADIUS_METERS,
        category_ids: session.interest_category_ids.join(","),
        session_id: session.id,
      });

      isFetchingRef.current = false;
      if (res.success && res.data) {
        const filtered = res.data.pois.filter(
          (p) => !completedIds.includes(p.id),
        );
        setTile(filtered, lat, lon);
      } else {
        setFetching(false);
      }
    },
    [session, poiStates, setTile, setFetching],
  );

  const runScan = useCallback(() => {
    const fix = locationRef.current;
    if (!fix || !session) return;

    const { lat, lon, heading, speed } = fix;
    const userHeading = heading ?? 0;
    const speedMs = speed ?? 0;
    const dynTrigger = triggerDistance(speedMs, NARRATION_BUFFER_SECONDS, AVG_NARRATION_SECONDS);

    // Tile edge detection — pre-fetch if within threshold
    if (
      tileCenterLat !== null &&
      tileCenterLon !== null &&
      !isFetchingRef.current &&
      nearTileEdge(lat, lon, tileCenterLat, tileCenterLon, TILE_RADIUS_METERS, TILE_REFRESH_THRESHOLD_METERS)
    ) {
      fetchTile(lat, lon);
    }

    // Score UNVISITED POIs within trigger distance; pre-synthesize Tier 3 within wider radius
    const candidates: QueuedPoi[] = [];
    for (const poi of tile) {
      const state = poiStates[poi.id];
      if (state && state !== "UNVISITED") continue;

      const dist = distanceMeters(lat, lon, poi.lat, poi.lon);

      // Pre-synthesize Tier 3 POIs approaching within PRE_SYNTHESIS_RADIUS_METERS
      if (
        dist <= PRE_SYNTHESIS_RADIUS_METERS &&
        poi.tier === 3 &&
        !preSynthesizedRef.current.has(poi.id)
      ) {
        preSynthesizedRef.current.add(poi.id);
        // Fire-and-forget — result cached in DB, picked up later by handlePoiReady
        api.synthesizePoi({ poi_id: poi.id }).catch(() => {
          // Remove from set so it retries next scan if it failed
          preSynthesizedRef.current.delete(poi.id);
        });
      }

      if (dist > dynTrigger) continue;

      const bearing = bearingDegrees(lat, lon, poi.lat, poi.lon);
      const dirScore = directionalScore(userHeading, bearing);
      const priority = poiPriority(dist, dirScore);

      candidates.push({ ...poi, state: "UNVISITED", priority });
    }

    // Queue top candidates (up to MAX_QUEUE_DEPTH - current queue size)
    const slotsAvailable = MAX_QUEUE_DEPTH - queue.length;
    const toQueue = candidates
      .sort((a, b) => b.priority - a.priority)
      .slice(0, slotsAvailable);

    for (const poi of toQueue) {
      queuePoi(poi);
    }

    // Kick off narration — use fresh queue from store (avoids stale closure)
    const canNarrate = canNarrateNow(MIN_GAP_BETWEEN_NARRATIONS_MS, MAX_NARRATIONS_PER_2_MIN);
    const freshQueue = useSessionStore.getState().queue;
    if (canNarrate && freshQueue.length > 0) {
      const next = freshQueue[0];
      if (next) onPoiReady(next);
    }
  }, [
    session,
    tile,
    poiStates,
    queue,
    tileCenterLat,
    tileCenterLon,
    fetchTile,
    queuePoi,
    canNarrateNow,
    onPoiReady,
  ]);

  // Keep ref current so the interval always calls the latest version
  useEffect(() => {
    runScanRef.current = runScan;
  }, [runScan]);

  const startScanner = useCallback(
    (initialLat: number, initialLon: number) => {
      if (scanTimer.current) return;
      fetchTile(initialLat, initialLon);
      scanTimer.current = setInterval(() => runScanRef.current(), SCAN_INTERVAL_MS);
    },
    [fetchTile],
  );

  const stopScanner = useCallback(() => {
    if (scanTimer.current) {
      clearInterval(scanTimer.current);
      scanTimer.current = null;
    }
    if (stationaryTimer.current) {
      clearTimeout(stationaryTimer.current);
      stationaryTimer.current = null;
    }
  }, []);

  // Handle stationary detection: pause scan loop, resume after cooldown
  const handleStationary = useCallback(
    (isStationary: boolean) => {
      if (isStationary && scanTimer.current) {
        clearInterval(scanTimer.current);
        scanTimer.current = null;

        stationaryTimer.current = setTimeout(() => {
          resetSkipped(); // SKIPPED → UNVISITED when resuming
          scanTimer.current = setInterval(() => runScanRef.current(), SCAN_INTERVAL_MS);
          stationaryTimer.current = null;
        }, STATIONARY_COOLDOWN_SECONDS * 1000);
      } else if (!isStationary && !scanTimer.current && !stationaryTimer.current) {
        scanTimer.current = setInterval(() => runScanRef.current(), SCAN_INTERVAL_MS);
      }
    },
    [resetSkipped],
  );

  // Pause the scan interval without losing tile or session state.
  // Use while tour is paused; call resumeScanner() to continue.
  const suspendScanner = useCallback(() => {
    if (scanTimer.current) {
      clearInterval(scanTimer.current);
      scanTimer.current = null;
    }
    if (stationaryTimer.current) {
      clearTimeout(stationaryTimer.current);
      stationaryTimer.current = null;
    }
  }, []);

  // Restart the scan interval after suspendScanner(). Does NOT re-fetch tiles.
  const resumeScanner = useCallback(() => {
    if (scanTimer.current) return; // already running
    scanTimer.current = setInterval(() => runScanRef.current(), SCAN_INTERVAL_MS);
  }, []);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  return {
    updateLocation,
    startScanner,
    stopScanner,
    suspendScanner,
    resumeScanner,
    handleStationary,
    fetchTile,
  };
}
