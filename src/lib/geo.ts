/**
 * Helper presentasi koordinat GPS.
 */

export interface Coords {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  accuracy_m?: number | null;
}

export function hasCoords(
  c: Coords,
): c is { latitude: number; longitude: number; accuracy_m?: number | null } {
  return (
    typeof c.latitude === "number" &&
    typeof c.longitude === "number" &&
    Number.isFinite(c.latitude) &&
    Number.isFinite(c.longitude)
  );
}

export function formatCoords(c: Coords, digits = 6): string {
  if (!hasCoords(c)) return "-";
  return `${c.latitude.toFixed(digits)}, ${c.longitude.toFixed(digits)}`;
}

export function formatAccuracy(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters))
    return "";
  if (meters < 1000) return `±${Math.round(meters)} m`;
  return `±${(meters / 1000).toFixed(1)} km`;
}

export function buildMapsUrl(c: Coords): string | null {
  if (!hasCoords(c)) return null;
  const q = `${c.latitude},${c.longitude}`;
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}`;
}
