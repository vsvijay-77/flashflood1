import L from "leaflet";

/**
 * Geodesic spherical area calculation for a polygon on Earth's surface (WGS84 ellipsoidal mean radius).
 * Returns the surface area enclosed by the polygon vertices in Square Metres (m²).
 */
export function calculatePolygonAreaSqMeters(
  coords: ([number, number] | { lat: number; lng: number } | L.LatLng)[]
): number {
  if (!coords || coords.length < 3) return 0;

  const points: { lat: number; lng: number }[] = coords.map((c) => {
    if (Array.isArray(c)) {
      return { lat: Number(c[0]), lng: Number(c[1]) };
    }
    return { lat: Number(c.lat), lng: Number(c.lng) };
  });

  const earthRadius = 6378137.0; // WGS84 mean equatorial radius in metres
  const toRad = Math.PI / 180.0;
  let total = 0;

  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p1LatRad = p1.lat * toRad;
    const p2LatRad = p2.lat * toRad;
    const dLngRad = (p2.lng - p1.lng) * toRad;

    // Spherical polygon trapezoidal area integration
    total += dLngRad * (2.0 + Math.sin(p1LatRad) + Math.sin(p2LatRad));
  }

  const area = Math.abs((total * earthRadius * earthRadius) / 2.0);
  return isNaN(area) ? 0 : area;
}

/**
 * Formats a square metre area number into human-readable strings with both m² and km² representations.
 */
export function formatArea(sqMeters: number): {
  sqMetersFormatted: string;
  sqKmFormatted: string;
  combined: string;
  brief: string;
  sqMetersRaw: number;
  sqKmRaw: number;
} {
  if (!sqMeters || isNaN(sqMeters) || sqMeters <= 0) {
    return {
      sqMetersFormatted: "0 sq. m",
      sqKmFormatted: "0.00 km²",
      combined: "0 sq. m",
      brief: "0 m²",
      sqMetersRaw: 0,
      sqKmRaw: 0,
    };
  }

  const sqKm = sqMeters / 1_000_000.0;
  const sqMetersRounded = Math.round(sqMeters);
  const sqMetersStr = `${sqMetersRounded.toLocaleString()} sq. m`;

  let sqKmStr = "";
  if (sqKm < 0.001) {
    sqKmStr = `${sqKm.toFixed(5)} km²`;
  } else if (sqKm < 0.1) {
    sqKmStr = `${sqKm.toFixed(4)} km²`;
  } else if (sqKm < 10) {
    sqKmStr = `${sqKm.toFixed(3)} km²`;
  } else {
    sqKmStr = `${sqKm.toLocaleString(undefined, { maximumFractionDigits: 2 })} km²`;
  }

  return {
    sqMetersFormatted: sqMetersStr,
    sqKmFormatted: sqKmStr,
    combined: `${sqMetersStr} (${sqKmStr})`,
    brief: `${sqMetersRounded.toLocaleString()} m²`,
    sqMetersRaw: sqMeters,
    sqKmRaw: sqKm,
  };
}

/**
 * Extracts polygon coordinate array `[[lat, lng], ...]` from database shape string or fallback center coordinates.
 */
export function parseCustomAreaPolygon(
  shape?: string,
  lat?: number,
  lng?: number
): [number, number][] {
  if (shape && shape.startsWith("Polygon:")) {
    try {
      const json = shape.substring("Polygon:".length);
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed) && parsed.length >= 3) {
        return parsed.map((p: any) => [Number(p[0]), Number(p[1])]);
      }
    } catch (e) {
      console.error("Error parsing Polygon: shape string", e);
    }
  } else if (shape) {
    try {
      const parsed = JSON.parse(shape);
      if (Array.isArray(parsed) && parsed.length >= 3 && Array.isArray(parsed[0])) {
        return parsed.map((p: any) => [Number(p[0]), Number(p[1])]);
      }
    } catch (e) {
      // not direct JSON
    }
  }

  // Fallback high-resolution 16-point natural perimeter around lat/lng if valid
  if (
    typeof lat === "number" &&
    typeof lng === "number" &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    (lat !== 0 || lng !== 0)
  ) {
    return generateCirclePolygon(lat, lng, 1200, 16);
  }

  return [];
}

/**
 * Generates an N-sided polygon approximating a circle around a center coordinate.
 * Useful for turning a single selected point or place into a defined monitored area.
 */
export function generateCirclePolygon(
  centerLat: number,
  centerLng: number,
  radiusMeters: number = 500,
  sides: number = 12
): [number, number][] {
  const coords: [number, number][] = [];
  const earthRadius = 6378137.0; // WGS84 mean equatorial radius in metres
  for (let i = 0; i < sides; i++) {
    const angle = (i * 360) / sides;
    const rad = (angle * Math.PI) / 180.0;
    const dLat = (radiusMeters * Math.cos(rad)) / earthRadius;
    const dLng =
      (radiusMeters * Math.sin(rad)) /
      (earthRadius * Math.cos((centerLat * Math.PI) / 180.0));
    const pLat = Number((centerLat + (dLat * 180.0) / Math.PI).toFixed(5));
    const pLng = Number((centerLng + (dLng * 180.0) / Math.PI).toFixed(5));
    coords.push([pLat, pLng]);
  }
  return coords;
}

/**
 * Standard ray-casting point-in-polygon algorithm.
 * Checks whether coordinate [lat, lng] is inside a polygon [[lat, lng], ...].
 */
export function isPointInPolygon(
  lat: number,
  lng: number,
  poly: [number, number][]
): boolean {
  if (!poly || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1];
    const yj = poly[j][0], xj = poly[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
