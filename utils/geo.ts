// utils/geo.ts
// Geospatial math for the POI scan loop

const EARTH_RADIUS_METERS = 6371000;

/** Haversine distance in meters between two lat/lon points */
export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Bearing in degrees (0–360) from point A to point B */
export function bearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Directional score [0–1] for a POI relative to the user's heading.
 * POIs directly ahead → 1.0, directly behind → 0.15.
 */
export function directionalScore(
  userHeading: number,
  bearingToPoi: number,
): number {
  const diff = Math.abs(((bearingToPoi - userHeading + 180) % 360) - 180);
  // diff = 0 → ahead, diff = 180 → behind
  const score = Math.cos(toRad(diff)) * 0.425 + 0.575;
  return Math.max(0.15, Math.min(1.0, score));
}

/**
 * POI priority score used to sort the narration queue.
 * priority = (1 / distance_m) × directional_score × category_weight
 */
export function poiPriority(
  distanceMeters: number,
  directional: number,
  categoryWeight = 1.0,
): number {
  if (distanceMeters <= 0) return 0;
  return (1 / distanceMeters) * directional * categoryWeight;
}

/**
 * Dynamic trigger distance per spec:
 * clamp(speed_ms × (buffer_s + avg_narration_s), min: 20m, max: 80m)
 */
export function triggerDistance(
  speedMs: number,
  bufferSeconds: number,
  avgNarrationSeconds: number,
): number {
  const raw = speedMs * (bufferSeconds + avgNarrationSeconds);
  return Math.max(20, Math.min(80, raw));
}

/**
 * Returns true if the user is within thresholdMeters of a tile edge.
 * tileCenterLat/Lon is the center of the current tile, tileRadiusMeters its radius.
 */
export function nearTileEdge(
  userLat: number,
  userLon: number,
  tileCenterLat: number,
  tileCenterLon: number,
  tileRadiusMeters: number,
  thresholdMeters: number,
): boolean {
  const d = distanceMeters(userLat, userLon, tileCenterLat, tileCenterLon);
  return d >= tileRadiusMeters - thresholdMeters;
}

/** Detect GPS teleport: >300m movement in <1 second (clearly impossible physically) */
export function isTeleport(
  distM: number,
  elapsedMs: number,
): boolean {
  return distM > 300 && elapsedMs < 1000;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
