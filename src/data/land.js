/**
 * Keeping boundaries on land.
 *
 * OpenStreetMap draws a coastal country's border where the law puts it: out
 * at the edge of its territorial waters, twelve nautical miles offshore. That
 * is correct as a boundary and wrong as a map outline. Nigeria's comes out
 * about 22 km south of the beach at Lagos, so a study-area outline, a locator
 * inset or a clip-to-area cut all ran out over the sea. Coastal states and
 * districts inherit some of the same.
 *
 * The fix is to take the sea away and nothing else. The ocean is read from
 * the very vector tiles the basemap is drawn from (OpenFreeMap, OpenMapTiles
 * schema, `water` layer, class "ocean"), so the trimmed coast lands exactly on
 * the shoreline the basemap paints, and the land borders are left precisely as
 * OpenStreetMap drew them — the same lines the basemap shows between
 * countries and states.
 *
 * Only tiles along the outline that actually hold ocean are fetched: a coarse
 * low-zoom pass finds where the sea is, then detailed tiles (z8, ~40 m
 * precision) are read just there. Tiles are kept in Cache Storage.
 *
 * Fail-open by design: if the tiles cannot be had, or the geometry will not
 * cut cleanly, the outline is used as OpenStreetMap drew it.
 */

import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import polygonClipping from 'polygon-clipping';
import turfDifference from '@turf/difference';
import { areaKm2, bboxOf, centroidOf } from '../core/geo.js';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const CACHE_NAME = 'gds-ocean-v1';
const COARSE_Z = 5;
const FINE_ZOOMS = [8, 7, 6];        // most detailed first; drop a level when an outline is huge
const MAX_COARSE_TILES = 48;
const MAX_FINE_TILES = 96;

// An earlier version kept geoBoundaries land outlines here; they are no longer used.
try { globalThis.caches?.delete('gds-land-v1').catch(() => {}); } catch { /* no Cache Storage */ }

let template = null;                  // Promise<string> — the tile URL pattern
const tiles = new Map();              // "z/x/y" → Promise<Feature[]> (ocean polygons)

function tileTemplate() {
  template ??= fetch(TILEJSON)
    .then((res) => { if (!res.ok) throw new Error(`${res.status} from tilejson`); return res.json(); })
    .then((tj) => { if (!tj.tiles?.[0]) throw new Error('tilejson has no tiles'); return tj.tiles[0]; })
    .catch((err) => { template = null; throw err; });
  return template;
}

async function cachedBuffer(url) {
  let store = null;
  try { store = await caches.open(CACHE_NAME); } catch { /* no Cache Storage (e.g. Node): fetch directly */ }
  const hit = await store?.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for tile`);
  try { await store?.put(url, res.clone()); } catch { /* quota: fine, just not cached */ }
  return res.arrayBuffer();
}

/* ---- tile maths (Web Mercator, XYZ) ---------------------------------- */
const n = (z) => 2 ** z;
const lngToX = (lng, z) => Math.min(n(z) - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n(z))));
const latToY = (lat, z) => {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const r = (clamped * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n(z));
  return Math.min(n(z) - 1, Math.max(0, y));
};
const xToLng = (x, z) => (x / n(z)) * 360 - 180;
const yToLat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n(z)))) * 180) / Math.PI;

function tileBox(z, x, y) {
  const w = xToLng(x, z); const e = xToLng(x + 1, z);
  const nth = yToLat(y, z); const s = yToLat(y + 1, z);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, nth], [w, nth], [w, s]]] } };
}

/** Every vertex of the area's polygons. */
function* vertices(geojson) {
  for (const f of geojson.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) yield* ring;
  }
}

/** Tiles at zoom z touched by the outline, grown by one tile all round so a coast just past a tile edge is not missed. */
function tilesAlongOutline(geojson, z) {
  const keys = new Set();
  for (const [lng, lat] of vertices(geojson)) {
    const x = lngToX(lng, z); const y = latToY(lat, z);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const tx = x + dx; const ty = y + dy;
        if (tx >= 0 && ty >= 0 && tx < n(z) && ty < n(z)) keys.add(`${z}/${tx}/${ty}`);
      }
    }
  }
  return [...keys];
}

/** The ocean polygons in one tile, as lng/lat features. */
function oceanIn(key) {
  if (!tiles.has(key)) {
    const load = (async () => {
      const [z, x, y] = key.split('/').map(Number);
      const url = (await tileTemplate()).replace('{z}', z).replace('{x}', x).replace('{y}', y);
      const vt = new VectorTile(new PbfReader(await cachedBuffer(url)));
      const layer = vt.layers.water;
      const out = [];
      for (let i = 0; layer && i < layer.length; i += 1) {
        const f = layer.feature(i);
        if (f.properties.class !== 'ocean') continue;
        const gj = f.toGeoJSON(x, y, z);
        if (gj.geometry?.type === 'Polygon' || gj.geometry?.type === 'MultiPolygon') {
          out.push({ type: 'Feature', properties: {}, geometry: gj.geometry });
        }
      }
      return out;
    })().catch((err) => { tiles.delete(key); throw err; });
    tiles.set(key, load);
  }
  return tiles.get(key);
}

/** Do two features' bounding boxes overlap? Cheap enough to run on a 40,000-vertex country. */
const boxesMeet = (a, b) => {
  const [aw, as, ae, an] = bboxOf(a); const [bw, bs, be, bn] = bboxOf(b);
  return aw <= be && bw <= ae && as <= bn && bs <= an;
};

const touches = (a, b) => {
  if (!boxesMeet(a, b)) return false;
  try { return polygonClipping.intersection(a.geometry.coordinates, b.geometry.coordinates).length > 0; } catch { return true; }
};

/**
 * The basemap's ocean along this outline, or [] when the area is inland.
 * Throws when the tiles cannot be read, so the caller can fail open.
 */
async function oceanAlong(geojson) {
  const coarseKeys = tilesAlongOutline(geojson, COARSE_Z);
  if (coarseKeys.length > MAX_COARSE_TILES) throw new Error('outline too large to trim');
  const coarse = (await Promise.all(coarseKeys.map(oceanIn))).flat();
  if (!coarse.length) return [];

  for (const z of FINE_ZOOMS) {
    const candidates = tilesAlongOutline(geojson, z);
    // Keep only tiles the coarse ocean reaches. The coarse coast is a little
    // generalised, but a fine tile is tens of kilometres across.
    const coastal = candidates.filter((key) => {
      const [tz, tx, ty] = key.split('/').map(Number);
      const box = tileBox(tz, tx, ty);
      return coarse.some((sea) => touches(box, sea));
    });
    if (coastal.length > MAX_FINE_TILES && z !== FINE_ZOOMS.at(-1)) continue;
    return (await Promise.all(coastal.map(oceanIn))).flat();
  }
  return [];
}

/**
 * geometry minus the seas. polygon-clipping works in plain floats and is
 * several times quicker than Turf's exact-arithmetic difference on a
 * 40,000-vertex country; Turf is kept only as a fallback if it ever throws.
 */
function cutAway(geometry, seas) {
  try {
    const rings = polygonClipping.difference(geometry.coordinates, ...seas.map((sea) => sea.geometry.coordinates));
    if (!rings.length) return null;
    return rings.length === 1 ? { type: 'Polygon', coordinates: rings[0] } : { type: 'MultiPolygon', coordinates: rings };
  } catch {
    const dry = turfDifference({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }, ...seas] });
    return dry?.geometry ?? null;
  }
}

/**
 * The same area, with the sea taken away.
 *
 * Land borders are untouched; only ocean is removed, along the coast the
 * basemap draws. Inland areas come back unchanged. Uploaded boundaries are
 * never touched — they are the user's own.
 *
 * @param {object} area  a study-area object (geojson, bbox, areaKm2, …)
 * @returns {Promise<object>} the trimmed area, or the original on any failure
 */
export async function clipAreaToLand(area) {
  if (!area?.geojson || area.osmType === 'upload' || area.seaTrimmed) return area;

  try {
    const ocean = await oceanAlong(area.geojson);
    if (!ocean.length) return area;

    const features = [];
    for (const f of area.geojson.features ?? []) {
      const type = f.geometry?.type;
      if (type !== 'Polygon' && type !== 'MultiPolygon') continue;
      const wet = ocean.filter((sea) => boxesMeet(f, sea));
      if (!wet.length) { features.push(f); continue; }
      const dry = cutAway(f.geometry, wet);
      if (dry) features.push({ ...f, geometry: dry });
    }
    // Nothing left means the outline and the sea disagree about where this
    // place is (an island the tiles miss, say); keep what OpenStreetMap said.
    if (!features.length) return area;

    const geojson = { type: 'FeatureCollection', features };
    return {
      ...area,
      geojson,
      bbox: bboxOf(geojson),
      areaKm2: areaKm2(geojson),
      center: centroidOf(geojson),
      seaTrimmed: true,
    };
  } catch (err) {
    console.warn(`[land] kept ${area.name} as drawn: ${err.message}`);
    return area;
  }
}
