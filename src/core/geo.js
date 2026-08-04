/** Geographic + formatting helpers. Turf does the real maths. */

import turfArea from '@turf/area';
import turfBbox from '@turf/bbox';
import turfCentroid from '@turf/centroid';
import turfBuffer from '@turf/buffer';

const unwrap = (m) => (typeof m === 'function' ? m : m.default);
const area = unwrap(turfArea);
const bbox = unwrap(turfBbox);
const centroid = unwrap(turfCentroid);
const buffer = unwrap(turfBuffer);

/** Area of any GeoJSON in km², using the geodesic (spherical) formula. */
export function areaKm2(geojson) {
  try { return area(geojson) / 1e6; } catch { return 0; }
}

/** [west, south, east, north] */
export function bboxOf(geojson) {
  try { return bbox(geojson); } catch { return null; }
}

/** [lng, lat] */
export function centroidOf(geojson) {
  try { return centroid(geojson).geometry.coordinates; } catch { return null; }
}

/** Circular buffer around a point, in kilometres. */
export function bufferPoint([lng, lat], radiusKm) {
  const point = { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} };
  try { return buffer(point, radiusKm, { units: 'kilometers' }); } catch { return null; }
}

/** MapLibre-shaped bounds from a bbox array. */
export const boundsFromBbox = (b) => (b ? [[b[0], b[1]], [b[2], b[3]]] : null);

/** Rough ground resolution in metres per screen pixel. */
export function metresPerPixel(lat, zoom) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/**
 * Pick a "nice" scale-bar length (1, 2, 2.5 or 5 × 10ⁿ) that fits within
 * `maxPx` and return both the rounded distance and the pixels it occupies.
 */
export function niceScaleBar(maxPx, mPerPx) {
  const maxMetres = maxPx * mPerPx;
  const pow = Math.pow(10, Math.floor(Math.log10(maxMetres)));
  let value = pow;
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (pow * step <= maxMetres) value = pow * step;
  }
  const km = value >= 1000;
  return {
    metres: value,
    px: value / mPerPx,
    label: km ? `${formatNumber(value / 1000)} km` : `${formatNumber(value)} m`,
  };
}

/** Thousands-separated, sensible precision. */
export function formatNumber(n, maxFrac) {
  if (!Number.isFinite(n)) return '—';
  const frac = maxFrac ?? (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2);
  return n.toLocaleString(undefined, { maximumFractionDigits: frac });
}

/** "1 234 km²" with a sensible unit for very small areas. */
export function formatArea(km2) {
  if (!Number.isFinite(km2) || km2 <= 0) return '—';
  if (km2 < 0.5) return `${formatNumber(km2 * 1e6, 0)} m²`;
  return `${formatNumber(km2)} km²`;
}

/** 7.4951 → 7°29′42″E */
export function formatDMS(value, axis) {
  const hemi = axis === 'lng' ? (value >= 0 ? 'E' : 'W') : value >= 0 ? 'N' : 'S';
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60);
  return `${deg}°${String(min).padStart(2, '0')}′${String(sec).padStart(2, '0')}″${hemi}`;
}

/** Rough geometry type of a FeatureCollection: 'point' | 'line' | 'polygon'. */
export function dominantGeometry(geojson) {
  const features = geojson?.features ?? (geojson ? [geojson] : []);
  const tally = { point: 0, line: 0, polygon: 0 };
  for (const f of features) {
    const t = f?.geometry?.type ?? '';
    if (t.includes('Point')) tally.point++;
    else if (t.includes('LineString')) tally.line++;
    else if (t.includes('Polygon')) tally.polygon++;
  }
  return Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
}

/** Total feature count, tolerant of bare geometries. */
export const featureCount = (geojson) => geojson?.features?.length ?? (geojson ? 1 : 0);

/** Convert an Overpass/GeoJSON bbox to the `s,w,n,e` order Overpass wants. */
export const bboxToOverpass = (b) => `${b[1]},${b[0]},${b[3]},${b[2]}`;

/* ------------------------------------------------------------------ */
/* Point-in-polygon (ray casting) — used to clip generated grids to a  */
/* study area without pulling in a heavier geometry engine.            */
/* ------------------------------------------------------------------ */
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(pt, rings) {
  if (!rings.length || !inRing(pt, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (inRing(pt, rings[i])) return false;  // hole
  return true;
}

/** Is [lng, lat] inside any polygon of this GeoJSON? */
export function pointInGeoJson(pt, geojson) {
  if (!geojson) return true;
  const features = geojson.features ?? [geojson];
  for (const f of features) {
    const g = f.geometry ?? f;
    if (!g) continue;
    if (g.type === 'Polygon' && inPolygon(pt, g.coordinates)) return true;
    if (g.type === 'MultiPolygon' && g.coordinates.some((poly) => inPolygon(pt, poly))) return true;
  }
  return false;
}
