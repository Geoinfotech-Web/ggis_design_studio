/**
 * World boundaries — every country, region and district on Earth.
 *
 * Served by the geodata cache server from server/data/world.db: Overture
 * Maps' divisions theme, which is OpenStreetMap's boundaries (ODbL), imported
 * by server/import-world.mjs. Being OSM's own borders, they line up with the
 * basemap and with the studio's other OSM lookups. Names are searched there as the user types, and an
 * outline arrives as one gzipped row, so neither waits on a public geocoder.
 *
 * When the server or the database is missing every call here resolves empty
 * (or throws, for an outline), and the area panel falls back to searching
 * OpenStreetMap the way it always has.
 */

import { areaKm2, bboxOf, centroidOf } from '../core/geo.js';

const BASE = `${(import.meta.env?.VITE_CACHE_URL ?? '/api/cache').replace(/\/$/, '')}/world`;

/** null until known; false once the server has said it has no world data. */
let available = null;
const outlines = new Map();   // id → Promise<area>

async function getJson(path, signal) {
  if (available === false) return [];
  try {
    const res = await fetch(`${BASE}${path}`, { signal });
    if (res.status === 503 || res.status === 502 || res.status === 504) { available = false; return []; }
    if (!res.ok) return [];
    available = true;
    return await res.json();
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return [];
  }
}

/**
 * Places matching what has been typed so far.
 * @param {string} q  "Ikeja" or "Ikeja, Lagos"
 * @param {{country?:string, level?:string, parent?:number, limit?:number, signal?:AbortSignal}} [opts]
 * @returns {Promise<Array<{id:number, name:string, level:string, country:string, countryCode:string,
 *                          parentName:string|null, bbox:number[], areaKm2:number}>>}
 */
export function searchWorld(q, { country = '', level = '', parent = null, limit = 8, signal } = {}) {
  const text = String(q ?? '').trim();
  if (text.length < 2) return Promise.resolve([]);
  const params = new URLSearchParams({ q: text, limit: String(limit) });
  if (country) params.set('country', country);
  if (level) params.set('level', level);
  if (parent) params.set('parent', String(parent));
  return getJson(`/search?${params}`, signal);
}

/** Every unit of a country at a level ("state"), or every child of a unit. */
export function listWorld({ country = '', level = 'state', parent = null } = {}) {
  const params = new URLSearchParams(parent ? { parent: String(parent) } : { country, level });
  return getJson(`/list?${params}`);
}

/** The unit's properties, sent as base64 UTF-8 JSON because header values must be ASCII. */
function fromHeader(value) {
  try {
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value ?? ''), (c) => c.charCodeAt(0))));
  } catch {
    return {};
  }
}

/** Whether the world database answered at least once (null: not asked yet). */
export const worldAvailable = () => available;

/** "Ikeja · Lagos, Nigeria" — where a result sits, for a suggestion row. */
export const placeLine = (unit) => [unit.parentName, unit.level === 'country' ? null : unit.country]
  .filter(Boolean).join(', ');

/**
 * One unit as a study area, outline included.
 * @param {number} id
 * @returns {Promise<object>} a study-area object
 */
export function worldArea(id) {
  if (!outlines.has(id)) {
    const load = (async () => {
      const res = await fetch(`${BASE}/unit/${id}`);
      if (!res.ok) throw new Error(`The world boundary service answered ${res.status}.`);
      const unit = fromHeader(res.headers.get('X-World-Unit'));
      const geometry = await res.json();
      const geojson = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { name: unit.name, country: unit.country }, geometry }],
      };
      const where = placeLine(unit);
      return {
        name: unit.name,
        displayName: where ? `${unit.name}, ${where}` : unit.name,
        level: unit.level,
        geojson,
        bbox: bboxOf(geojson) ?? unit.bbox,
        areaKm2: areaKm2(geojson),
        center: centroidOf(geojson),
        countryCode: unit.countryCode ?? '',
        parentName: unit.parentName ?? undefined,
        osmType: 'world',
        // Unique across the studio's other sources, so two areas never collide.
        osmId: `gb/${id}`,
        source: 'OpenStreetMap (via Overture Maps)',
        // Overture's land outlines stop at the coast already, and the
        // importer leaves them topologically clean (server/topology.mjs).
        seaTrimmed: true,
        topologyClean: true,
      };
    })().catch((err) => { outlines.delete(id); throw err; });
    outlines.set(id, load);
  }
  return outlines.get(id);
}
