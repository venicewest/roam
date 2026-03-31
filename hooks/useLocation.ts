// hooks/useLocation.ts
// GPS wrapper with accuracy filtering, teleport detection,
// rolling speed average, stationary detection, and background task.
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  GPS_ACCURACY_THRESHOLD_METERS,
  ROLLING_SPEED_WINDOW_SECONDS,
  SCAN_INTERVAL_MS,
  STATIONARY_SPEED_MS,
} from "../constants/config";
import { distanceMeters, isTeleport } from "../utils/geo";
import { isAccurateEnough } from "../utils/coordinates";

export const BACKGROUND_LOCATION_TASK = "roam-background-location";

export type LocationFix = {
  lat: number;
  lon: number;
  accuracy: number;
  heading: number | null; // degrees 0–360
  speed: number | null; // m/s
  timestamp: number;
};

type SpeedSample = { speed: number; timestamp: number };

type LocationState = {
  current: LocationFix | null;
  rollingSpeedMs: number; // 15s rolling average
  isStationary: boolean;
  hasPermission: boolean;
  isTracking: boolean;
};

// Define background task (must be at module level)
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error) {
    console.warn("[Location] Background task error:", error.message);
    return;
  }
  if (data?.locations?.length) {
    // Background updates are handled via foreground subscription in active tours.
    // This task keeps the OS from killing location when screen locks.
  }
});

export function useLocation() {
  const [state, setState] = useState<LocationState>({
    current: null,
    rollingSpeedMs: 0,
    isStationary: false,
    hasPermission: false,
    isTracking: false,
  });

  const speedSamples = useRef<SpeedSample[]>([]);
  const lastFix = useRef<LocationFix | null>(null);
  const subscription = useRef<Location.LocationSubscription | null>(null);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== "granted") return false;

    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    const granted = fg === "granted"; // bg optional on Android; required for iOS background
    setState((s) => ({ ...s, hasPermission: granted }));
    return granted;
  }, []);

  const processFix = useCallback((raw: Location.LocationObject) => {
    const accuracy = raw.coords.accuracy ?? 999;
    if (!isAccurateEnough(accuracy, GPS_ACCURACY_THRESHOLD_METERS)) return;

    const now = raw.timestamp;
    const fix: LocationFix = {
      lat: raw.coords.latitude,
      lon: raw.coords.longitude,
      accuracy,
      heading: raw.coords.heading ?? null,
      speed: raw.coords.speed ?? null,
      timestamp: now,
    };

    // Teleport detection
    if (lastFix.current) {
      const dist = distanceMeters(
        lastFix.current.lat,
        lastFix.current.lon,
        fix.lat,
        fix.lon,
      );
      const elapsed = now - lastFix.current.timestamp;
      if (isTeleport(dist, elapsed)) {
        console.warn("[Location] Teleport detected, discarding fix");
        return;
      }
    }

    // Update rolling speed samples (15s window)
    const windowMs = ROLLING_SPEED_WINDOW_SECONDS * 1000;
    speedSamples.current = [
      ...speedSamples.current.filter((s) => now - s.timestamp < windowMs),
      { speed: fix.speed ?? 0, timestamp: now },
    ];

    const rollingSpeedMs =
      speedSamples.current.reduce((sum, s) => sum + s.speed, 0) /
      Math.max(speedSamples.current.length, 1);

    const isStationary = rollingSpeedMs < STATIONARY_SPEED_MS;

    lastFix.current = fix;
    setState((s) => ({ ...s, current: fix, rollingSpeedMs, isStationary }));
  }, []);

  const startTracking = useCallback(async () => {
    if (subscription.current) return; // already tracking

    subscription.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: SCAN_INTERVAL_MS,
        distanceInterval: 5,
      },
      processFix,
    );

    // Start background task so location continues when screen locks
    const isRegistered = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_LOCATION_TASK,
    );
    if (!isRegistered) {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: SCAN_INTERVAL_MS,
        distanceInterval: 5,
        foregroundService: {
          notificationTitle: "Roam is active",
          notificationBody: "Finding nearby points of interest…",
          notificationColor: "#e8c547",
        },
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
      });
    }

    setState((s) => ({ ...s, isTracking: true }));
  }, [processFix]);

  const stopTracking = useCallback(async () => {
    subscription.current?.remove();
    subscription.current = null;

    const isRegistered = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_LOCATION_TASK,
    );
    if (isRegistered) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }

    speedSamples.current = [];
    lastFix.current = null;
    setState((s) => ({
      ...s,
      isTracking: false,
      current: null,
      rollingSpeedMs: 0,
      isStationary: false,
    }));
  }, []);

  useEffect(() => {
    return () => {
      subscription.current?.remove();
    };
  }, []);

  return {
    ...state,
    requestPermissions,
    startTracking,
    stopTracking,
  };
}
