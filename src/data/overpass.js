/**
 * Overpass API client.
 *
 * Public Overpass instances are a shared community resource, so this
 * module: caches every response for the session, refuses obviously
 * oversized requests before sending them, serialises calls behind a
 * queue, and falls back to a mirror if the primary is busy.
 */

import osmtogeojson from 'osmtogeojson';
import { ENDPOINTS } from '../core/constants.js';
import { bboxToOverpass } from '../core/geo.js';

const cache = new Map();
let chain = Promise.resolve();

/** Rough bbox area in km² — used to stop absurd downloads early. */
function bboxAreaKm2([w, s, e, n]) {
  const midLat = (s + n) / 2;
  return Math.abs(e - w) * 111.32 * Math.cos((midLat * Math.PI) / 180) * Math.abs(n - s) * 110.57;
}

export const AREA_LIMITS = { heavy: 2500, normal: 60000 };

/**
 * Is this dataset safe to fetch for this bbox?
 * @returns {{ ok: boolean, areaKm2: number, limit: number, reason?: string }}
 */
export function checkSize(dataset, bbox) {
  const areaKm2 = bboxAreaKm2(bbox);
  const limit = dataset.heavy ? AREA_LIMITS.heavy : AREA_LIMITS.normal;
  if (areaKm2 > limit) {
    return {
      ok: false, areaKm2, limit,
      reason: `“${dataset.name}” over ${Math.round(areaKm2).toLocaleString()} km² is too much for the free Overpass service. Zoom into a smaller study area (under ${limit.toLocaleString()} km²) and try again.`,
    };
  }
  return { ok: true, areaKm2, limit };
}

/** Build the full Overpass QL document for a catalogue entry. */
export function buildQuery(dataset, bbox, timeout = 90) {
  const bboxStr = bboxToOverpass(bbox);
  const body = dataset.body.replace(/\$bbox/g, bboxStr);
  return `[out:json][timeout:${timeout}];\n(\n${body}\n);\nout geom qt;`;
}

async function post(url, query, signal) {
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (res.status === 429 || res.status === 504) throw Object.assign(new Error('busy'), { retryable: true });
  if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
  return res.json();
}

/**
 * Fetch one catalogue dataset for a bbox and return GeoJSON.
 * @param {import('./osm-catalog.js').OsmDataset} dataset
 * @param {number[]} bbox  [w, s, e, n]
 * @param {{signal?: AbortSignal, onProgress?: (msg: string) => void}} [opts]
 */
export function fetchDataset(dataset, bbox, opts = {}) {
  const query = buildQuery(dataset, bbox);
  const key = `${dataset.slug}|${bbox.map((n) => n.toFixed(4)).join(',')}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));

  // Serialise so a user clicking six datasets does not hammer the API.
  const run = chain.then(async () => {
    let lastError;
    for (const url of ENDPOINTS.overpass) {
      try {
        opts.onProgress?.(`Querying OpenStreetMap…`);
        const raw = await post(url, query, opts.signal);
        const geojson = osmtogeojson(raw, { flatProperties: true });
        // Overpass returns bare nodes for `nwr` matches on ways; drop empties.
        geojson.features = (geojson.features ?? []).filter((f) => f.geometry);
        cache.set(key, geojson);
        return geojson;
      } catch (err) {
        lastError = err;
        if (err.name === 'AbortError') throw err;
        opts.onProgress?.('Primary server busy — trying a mirror…');
      }
    }
    throw lastError ?? new Error('All Overpass endpoints failed');
  });

  chain = run.catch(() => {});   // keep the queue alive after a failure
  return run;
}

export function clearCache() { cache.clear(); }
export const cacheSize = () => cache.size;
