/**
 * Open data from the basemap's own vector tiles — the fast, always-on backup.
 *
 * Overpass, where the studio gets OpenStreetMap features, is a donated public
 * service. Outside the areas already in the shared database it can take 40
 * seconds to answer, or not answer at all: on a bad day every mirror goes
 * quiet and a layer simply never arrives. That is not something this app can
 * fix on Overpass's side.
 *
 * But the same OpenStreetMap data is already being served to this page as
 * the basemap: OpenFreeMap's vector tiles (OpenMapTiles schema), from a CDN
 * that answers in a fraction of a second, worldwide. Roads, railways, rivers,
 * lakes, forests, parks, places, airports, buildings and points of interest
 * are all in them. So when Overpass is slow or refuses an area, a dataset is
 * built from those tiles instead.
 *
 * How a tile feature becomes a dataset feature:
 *  - its OpenMapTiles class/subclass is translated back into OpenStreetMap
 *    tags (`transportation` class "primary" → highway=primary, a poi subclass
 *    "hospital" → amenity=hospital), so the catalogue's own Overpass query —
 *    compiled to a tag filter by server/ql.js — decides membership, and the
 *    usual classifier, symbols and legend apply unchanged;
 *  - it is clipped to its own tile, so a road crossing a tile edge is not
 *    counted twice.
 *
 * Trade-offs, stated in the result's meta so the panel can say so: geometry
 * is generalised for the zoom it was read at, tiles carry fewer tags than
 * OpenStreetMap (no religion on places of worship, for instance), and power
 * lines, oil and gas and a few others are not in the tiles at all.
 */

import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import polygonClipping from 'polygon-clipping';
import { compileQuery } from '../../server/ql.js';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const CACHE_NAME = 'gds-vtiles-v1';
/**
 * Most tiles one dataset may pull, ~60–150 KB each, fetched in parallel.
 * Low-zoom tiles are small and cover a lot of ground, so a country-sized
 * request for major roads or railways gets a larger allowance.
 */
const TILE_BUDGET = 64;
const LOW_ZOOM_BUDGET = 160;
const budgetAt = (z) => (z <= 10 ? LOW_ZOOM_BUDGET : TILE_BUDGET);
const PARALLEL = 8;

/**
 * Which tile layers carry a dataset, and the zoom range to read them at.
 * `min` is the lowest zoom at which the dataset's features exist in the
 * tiles (measured: secondary roads, rivers and villages appear at z9, local
 * streets at z12, points of interest essentially only at z14). The reader
 * picks the most detailed zoom up to `max` that fits the tile budget.
 */
const SPECS = {
  'roads-major':   { layers: ['transportation'], min: 9, max: 12 },
  'roads-local':   { layers: ['transportation'], min: 12, max: 14 },
  railways:        { layers: ['transportation'], min: 8, max: 12 },
  ferry:           { layers: ['transportation'], min: 10, max: 12 },
  bridges:         { layers: ['transportation'], min: 12, max: 14 },
  airports:        { layers: ['aeroway', 'aerodrome_label'], min: 10, max: 13 },
  rivers:          { layers: ['waterway'], min: 9, max: 13 },
  waterbodies:     { layers: ['water'], min: 10, max: 13 },
  forests:         { layers: ['landcover', 'landuse'], min: 9, max: 12 },
  farmland:        { layers: ['landcover', 'landuse'], min: 10, max: 12 },
  protected:       { layers: ['park'], min: 8, max: 12 },
  settlements:     { layers: ['place'], min: 10, max: 13 },
  industrial:      { layers: ['landuse'], min: 12, max: 13 },
  cemeteries:      { layers: ['landuse'], min: 13, max: 14 },
  buildings:       { layers: ['building'], min: 14, max: 14 },
};
const POI_DATASETS = ['bus-stops', 'fuel', 'parking', 'health', 'education', 'water-points', 'markets', 'emergency',
  'worship', 'banks', 'government', 'post-telecom', 'hotels', 'food', 'sports', 'culture', 'waste'];
// Points only: the poi layer already has a point for every mapped area, so
// reading landuse as well would count each hospital or school twice.
for (const slug of POI_DATASETS) SPECS[slug] = { layers: ['poi'], min: 14, max: 14 };

/* ---- OpenMapTiles → OpenStreetMap tags ----------------------------- */

const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const POI_KEY = {};
const keyFor = (key, values) => values.split(' ').forEach((v) => { POI_KEY[v] = key; });
keyFor('amenity', 'hospital clinic doctors dentist pharmacy school kindergarten college university library bank atm '
  + 'bureau_de_change police fire_station townhall courthouse post_office fuel parking bus_station taxi marketplace '
  + 'place_of_worship restaurant cafe fast_food bar pub food_court cinema theatre community_centre arts_centre prison '
  + 'toilets drinking_water water_point waste_disposal recycling waste_basket ferry_terminal embassy veterinary '
  + 'grave_yard shelter ranger_station social_facility nursing_home childcare charging_station car_wash car_rental '
  + 'ice_cream biergarten nightclub casino');
keyFor('tourism', 'hotel motel guest_house hostel museum attraction viewpoint information zoo artwork gallery '
  + 'camp_site caravan_site chalet theme_park picnic_site');
keyFor('leisure', 'park stadium sports_centre pitch swimming_pool playground garden golf_course nature_reserve marina '
  + 'water_park fitness_centre ice_rink dog_park');
keyFor('historic', 'monument memorial castle ruins archaeological_site wayside_shrine fort');
keyFor('man_made', 'water_well water_tower lighthouse windmill tower mast communications_tower');
keyFor('office', 'government');
keyFor('railway', 'station halt tram_stop subway_entrance');
keyFor('highway', 'bus_stop');
keyFor('emergency', 'ambulance_station');
keyFor('healthcare', 'laboratory');
const NATURAL = new Set(['bare_rock', 'beach', 'dune', 'scrub', 'fell', 'glacier', 'grassland', 'heath', 'sand', 'scree',
  'wetland', 'wood', 'tundra', 'bog', 'marsh', 'swamp', 'mangrove', 'reedbed', 'saltmarsh', 'tidalflat', 'wet_meadow']);
const WETLAND = new Set(['bog', 'marsh', 'swamp', 'mangrove', 'reedbed', 'saltmarsh', 'tidalflat', 'wet_meadow']);

/** OpenStreetMap-style tags for one tile feature, or null if it has no OSM equivalent here. */
export function osmTagsFor(layer, p) {
  const t = {};
  const cls = p.class; const sub = p.subclass;
  switch (layer) {
    case 'transportation':
      if (ROAD_CLASSES.has(cls)) t.highway = p.ramp ? `${cls}_link` : cls;
      else if (cls === 'minor') t.highway = 'residential';
      else if (cls === 'service') t.highway = 'service';
      else if (cls === 'track') t.highway = 'track';
      else if (cls === 'path') t.highway = sub || 'path';
      else if (cls === 'rail' || cls === 'transit') t.railway = sub || 'rail';
      else if (cls === 'ferry') t.route = 'ferry';
      else return null;
      if (p.brunnel === 'bridge') t.bridge = 'yes';
      if (p.brunnel === 'tunnel') t.tunnel = 'yes';
      if (p.surface) t.surface = p.surface;
      break;
    case 'waterway':
      t.waterway = cls; break;
    case 'water':
      if (cls === 'ocean') return null;
      t.natural = 'water'; t.water = cls === 'lake' ? 'lake' : cls; break;
    case 'landcover':
      if (!sub) return null;
      if (NATURAL.has(sub)) { t.natural = WETLAND.has(sub) ? 'wetland' : sub; if (WETLAND.has(sub)) t.wetland = sub; } else t.landuse = sub === 'farm' ? 'farmland' : sub;
      break;
    case 'landuse':
      if (!cls) return null;
      if (['school', 'university', 'college', 'kindergarten', 'hospital'].includes(cls)) t.amenity = cls;
      else t.landuse = cls;
      break;
    case 'park':
      if (cls === 'national_park') t.boundary = 'national_park';
      else if (cls === 'nature_reserve') t.leisure = 'nature_reserve';
      else t.boundary = 'protected_area';
      break;
    case 'place':
      if (['country', 'state', 'province', 'continent'].includes(cls)) return null;
      t.place = cls; break;
    case 'aeroway':
      t.aeroway = cls; break;
    case 'aerodrome_label':
      t.aeroway = 'aerodrome'; break;
    case 'building':
      t.building = 'yes'; break;
    case 'poi': {
      const value = sub || cls;
      const key = POI_KEY[value] ?? (cls === 'shop' || POI_KEY[value] === undefined ? 'shop' : null);
      if (!key) return null;
      t[key] = value;
      if (value === 'station') t.public_transport = 'station';
      if (value === 'marketplace') t.shop = t.shop ?? 'market';
      break;
    }
    default:
      return null;
  }
  if (p.name) t.name = p.name;
  if (p['name:en'] && !t.name) t.name = p['name:en'];
  return t;
}

/* ---- tile maths ------------------------------------------------------ */
const n = (z) => 2 ** z;
const lngToX = (lng, z) => Math.min(n(z) - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n(z))));
const latToY = (lat, z) => {
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return Math.min(n(z) - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n(z))));
};
const xToLng = (x, z) => (x / n(z)) * 360 - 180;
const yToLat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n(z)))) * 180) / Math.PI;

function tilesFor([w, s, e, nth], z) {
  const x0 = lngToX(w, z); const x1 = lngToX(e, z);
  const y0 = latToY(nth, z); const y1 = latToY(s, z);
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  return out;
}
const tileCount = ([w, s, e, nth], z) => (lngToX(e, z) - lngToX(w, z) + 1) * (latToY(s, z) - latToY(nth, z) + 1);

/** The zoom this dataset would be read at for this box, or null if no zoom fits the budget. */
export function tileZoomFor(dataset, bbox) {
  const spec = SPECS[dataset?.slug];
  if (!spec || !bbox) return null;
  for (let z = spec.max; z >= spec.min; z--) if (tileCount(bbox, z) <= budgetAt(z)) return z;
  return null;
}

/** Can this dataset be served from tiles at all (any area)? */
export const hasTileSource = (dataset) => Boolean(SPECS[dataset?.slug]);

/* ---- fetching -------------------------------------------------------- */
let template = null;
function tileTemplate() {
  template ??= fetch(TILEJSON)
    .then((r) => { if (!r.ok) throw new Error(`tilejson ${r.status}`); return r.json(); })
    .then((tj) => tj.tiles[0])
    .catch((err) => { template = null; throw err; });
  return template;
}

async function tileBuffer(z, x, y, signal) {
  const url = (await tileTemplate()).replace('{z}', z).replace('{x}', x).replace('{y}', y);
  let store = null;
  try { store = await caches.open(CACHE_NAME); } catch { /* no Cache Storage */ }
  const hit = await store?.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: ${res.status}`);
  try { await store?.put(url, res.clone()); } catch { /* quota */ }
  return res.arrayBuffer();
}

/** Cut a line to a box: Liang–Barsky per segment, joined back into runs. */
function clipLine(coords, [w, s, e, nth]) {
  const runs = []; let run = [];
  const push = (p) => { const last = run[run.length - 1]; if (!last || last[0] !== p[0] || last[1] !== p[1]) run.push(p); };
  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1]; const [x1, y1] = coords[i];
    const dx = x1 - x0; const dy = y1 - y0;
    let t0 = 0; let t1 = 1; let ok = true;
    for (const [pp, qq] of [[-dx, x0 - w], [dx, e - x0], [-dy, y0 - s], [dy, nth - y0]]) {
      if (pp === 0) { if (qq < 0) { ok = false; break; } continue; }
      const r = qq / pp;
      if (pp < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { if (run.length > 1) runs.push(run); run = []; continue; }
    push([x0 + t0 * dx, y0 + t0 * dy]);
    push([x0 + t1 * dx, y0 + t1 * dy]);
    if (t1 < 1) { if (run.length > 1) runs.push(run); run = []; }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** A tile feature's geometry, cut to the tile itself (tiles overlap by a buffer). */
function clipToTile(geometry, box) {
  const [w, s, e, nth] = box;
  const inside = ([x, y]) => x >= w && x < e && y >= s && y < nth;
  switch (geometry.type) {
    case 'Point': return inside(geometry.coordinates) ? geometry : null;
    case 'MultiPoint': { const pts = geometry.coordinates.filter(inside); return pts.length ? { type: 'MultiPoint', coordinates: pts } : null; }
    case 'LineString':
    case 'MultiLineString': {
      const lines = (geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates).flatMap((l) => clipLine(l, box));
      if (!lines.length) return null;
      return lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines };
    }
    case 'Polygon':
    case 'MultiPolygon': {
      const rect = [[[w, s], [e, s], [e, nth], [w, nth], [w, s]]];
      try {
        const out = polygonClipping.intersection(geometry.coordinates, rect);
        if (!out.length) return null;
        return out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out };
      } catch { return geometry; }
    }
    default: return null;
  }
}

const queries = new Map();
const queryFor = (dataset) => {
  if (!queries.has(dataset.slug)) queries.set(dataset.slug, compileQuery(dataset.body));
  return queries.get(dataset.slug);
};

/**
 * Build a dataset for a box from the basemap's vector tiles.
 * @returns {Promise<object>} GeoJSON FeatureCollection with meta.fromTiles
 */
export async function fetchFromTiles(dataset, bbox, { signal, onProgress } = {}) {
  const spec = SPECS[dataset.slug];
  const z = tileZoomFor(dataset, bbox);
  if (!spec || z === null) throw new Error(`${dataset.name} cannot be read from map tiles for an area this size.`);
  const query = queryFor(dataset);
  const tiles = tilesFor(bbox, z);
  const started = Date.now();
  onProgress?.(`Reading ${tiles.length} map tile${tiles.length === 1 ? '' : 's'}…`);

  const features = [];
  const seen = new Set();
  let next = 0; let done = 0;
  const worker = async () => {
    while (next < tiles.length) {
      const [tz, tx, ty] = tiles[next++];
      const vt = new VectorTile(new PbfReader(await tileBuffer(tz, tx, ty, signal)));
      const box = [xToLng(tx, tz), yToLat(ty + 1, tz), xToLng(tx + 1, tz), yToLat(ty, tz)];
      for (const layerName of spec.layers) {
        const layer = vt.layers[layerName];
        for (let i = 0; layer && i < layer.length; i++) {
          const f = layer.feature(i);
          const tags = osmTagsFor(layerName, f.properties);
          if (!tags) continue;
          const elementType = f.type === 1 ? 'node' : 'way';
          if (!query.match(elementType, tags)) continue;
          // Points carry a stable OSM-derived id in the tiles; one seen in a
          // neighbouring tile's buffer is the same place.
          if (f.type === 1 && f.id !== undefined) {
            const key = `${layerName}:${f.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
          }
          const geometry = clipToTile(f.toGeoJSON(tx, ty, tz).geometry, box);
          if (!geometry) continue;
          features.push({ type: 'Feature', id: f.id !== undefined ? `t${layerName}/${f.id}` : undefined, properties: { ...tags, gds_source: 'OpenFreeMap tiles' }, geometry });
        }
      }
      done += 1;
      if (done % 8 === 0) onProgress?.(`Reading map tiles — ${done} of ${tiles.length}…`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, tiles.length) }, worker));
  return {
    type: 'FeatureCollection',
    features,
    meta: { fromTiles: true, zoom: z, tiles: tiles.length, host: 'OpenFreeMap tiles', seconds: Math.round((Date.now() - started) / 100) / 10 },
  };
}
