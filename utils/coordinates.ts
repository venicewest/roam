// utils/coordinates.ts

/** Returns true if a GPS fix meets accuracy requirements */
export function isAccurateEnough(
  accuracyMeters: number,
  thresholdMeters = 25,
): boolean {
  return accuracyMeters <= thresholdMeters;
}

/** Returns true if coords are valid lat/lon */
export function isValidCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Bounding box around a center point.
 * Returns { minLat, maxLat, minLon, maxLon }
 */
export function boundingBox(
  lat: number,
  lon: number,
  radiusMeters: number,
): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
  const latDelta = (radiusMeters / 111320);
  const lonDelta = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  };
}
