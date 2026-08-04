/**
 * "Bring your own data" — GeoJSON, KML, KMZ, GPX, CSV with lat/lon
 * columns, and zipped Shapefiles.
 *
 * Everything is parsed in the browser; nothing is uploaded anywhere.
 */

import { kml, gpx } from '@tmcw/togeojson';

export const ACCEPTED = '.geojson,.json,.kml,.kmz,.gpx,.zip,.csv,.txt';

const readText = (file) => file.text();
const readBuffer = (file) => file.arrayBuffer();

function xmlToGeoJson(text, converter) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('That file is not valid XML.');
  return converter(doc);
}

/* --- minimal CSV parser: handles quoted fields and commas ---------- */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const LAT_KEYS = ['lat', 'latitude', 'y', 'ycoord', 'y_coord', 'northing'];
const LON_KEYS = ['lon', 'lng', 'long', 'longitude', 'x', 'xcoord', 'x_coord', 'easting'];

function csvToGeoJson(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('That CSV has no data rows.');
  const header = rows[0].map((h) => h.trim());
  const norm = header.map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  const latIdx = norm.findIndex((h) => LAT_KEYS.includes(h));
  const lonIdx = norm.findIndex((h) => LON_KEYS.includes(h));
  if (latIdx < 0 || lonIdx < 0) {
    throw new Error('Could not find latitude/longitude columns. Name them "lat" and "lon" (or "latitude"/"longitude").');
  }
  const features = [];
  for (const row of rows.slice(1)) {
    const lat = Number(row[latIdx]);
    const lon = Number(row[lonIdx]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const properties = {};
    header.forEach((h, i) => { if (i !== latIdx && i !== lonIdx) properties[h] = row[i]; });
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties });
  }
  if (!features.length) throw new Error('No rows had usable coordinates.');
  return { type: 'FeatureCollection', features };
}

/** Normalise anything into a FeatureCollection. */
function asCollection(input) {
  if (!input) throw new Error('Nothing to read.');
  if (Array.isArray(input)) {
    return { type: 'FeatureCollection', features: input.flatMap((c) => c.features ?? []) };
  }
  if (input.type === 'FeatureCollection') return input;
  if (input.type === 'Feature') return { type: 'FeatureCollection', features: [input] };
  if (input.type) return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: input, properties: {} }] };
  throw new Error('Unrecognised geographic data.');
}

/**
 * Parse a File into GeoJSON.
 * @param {File} file
 * @returns {Promise<{geojson: object, name: string, format: string}>}
 */
export async function parseGeoFile(file) {
  const name = file.name.replace(/\.[^.]+$/, '');
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();

  switch (ext) {
    case 'geojson':
    case 'json': {
      const parsed = JSON.parse(await readText(file));
      return { geojson: asCollection(parsed), name, format: 'GeoJSON' };
    }
    case 'kml':
      return { geojson: asCollection(xmlToGeoJson(await readText(file), kml)), name, format: 'KML' };
    case 'gpx':
      return { geojson: asCollection(xmlToGeoJson(await readText(file), gpx)), name, format: 'GPX' };
    case 'csv':
    case 'txt':
      return { geojson: csvToGeoJson(await readText(file)), name, format: 'CSV' };
    case 'kmz':
    case 'zip': {
      // shpjs also unzips KMZ-style archives containing .shp/.dbf/.prj sets.
      const { default: shp } = await import('shpjs');
      const parsed = await shp(await readBuffer(file));
      return { geojson: asCollection(parsed), name, format: ext === 'kmz' ? 'KMZ' : 'Shapefile (zip)' };
    }
    default:
      throw new Error(`Cannot read “.${ext}” files. Supported: GeoJSON, KML, KMZ, GPX, CSV, zipped Shapefile.`);
  }
}

/** Property keys shared by every feature — offered as label fields. */
export function propertyKeys(geojson, limit = 40) {
  const keys = new Set();
  for (const f of (geojson.features ?? []).slice(0, 200)) {
    for (const k of Object.keys(f.properties ?? {})) {
      keys.add(k);
      if (keys.size >= limit) return Array.from(keys);
    }
  }
  return Array.from(keys);
}

/** Numeric property keys — candidates for graduated / choropleth styling. */
export function numericKeys(geojson) {
  const counts = new Map();
  const sample = (geojson.features ?? []).slice(0, 200);
  for (const f of sample) {
    for (const [k, v] of Object.entries(f.properties ?? {})) {
      if (v !== '' && v !== null && Number.isFinite(Number(v))) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, n]) => n >= sample.length * 0.6)
    .map(([k]) => k);
}
