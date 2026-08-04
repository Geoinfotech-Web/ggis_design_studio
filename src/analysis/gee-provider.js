/**
 * Google Earth Engine provider.
 *
 * Earth Engine cannot be called safely from a browser: it needs a
 * service-account key and server-side `ee` evaluation. So this provider
 * talks to a small backend of your own over a fixed JSON contract. The
 * backend is the only piece you have to write to go from demo data to
 * real satellite analysis.
 *
 * ── Request ────────────────────────────────────────────────────────
 *   POST {endpoint}/run
 *   {
 *     "job":    "lulc",                       // analysis/jobs.js id
 *     "params": { "start": "2024-01", ... },  // job.params values
 *     "area":   { "name": "Rivers", "geojson": <FeatureCollection> }
 *   }
 *
 * ── Response ───────────────────────────────────────────────────────
 *   {
 *     "type":    "raster",                    // or "vector"
 *     "tileUrl": "https://earthengine.googleapis.com/v1alpha/.../tiles/{z}/{x}/{y}",
 *     "geojson": { ... },                     // when type === "vector"
 *     "legend":  [ { "label": "Built-up", "color": "#fa0000" } ],
 *     "stats":   { ... },                     // shape matches the job
 *     "summary": "Built-up covers 18.4% of the study area."
 *   }
 *
 * A reference implementation in Node looks like:
 *
 *   const ee = require('@google/earthengine');
 *   ee.data.authenticateViaPrivateKey(key, () => ee.initialize(null, null, () => {
 *     const aoi = ee.FeatureCollection(req.body.area.geojson);
 *     const img = ee.ImageCollection('ESA/WorldCover/v200').first().clip(aoi);
 *     img.getMap({ bands: ['Map'] }, ({ urlFormat }) => res.json({ type: 'raster', tileUrl: urlFormat, ... }));
 *   }));
 */

import { legendFor } from './jobs.js';

const DEFAULT_ENDPOINT = import.meta.env?.VITE_GEE_ENDPOINT ?? '';
const STORAGE_KEY = 'gds.gee.endpoint';

export function geeEndpoint() {
  try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_ENDPOINT; } catch { return DEFAULT_ENDPOINT; }
}

export function setGeeEndpoint(url) {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url.replace(/\/+$/, ''));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode */ }
}

export const geeProvider = {
  id: 'gee',
  label: 'Google Earth Engine',
  description: 'Add your backend URL under Analysis → Engine settings. See src/analysis/gee-provider.js for the request/response contract.',
  synthetic: false,

  available: () => Boolean(geeEndpoint()),

  async run({ job, params, area }, { onProgress, signal } = {}) {
    const endpoint = geeEndpoint();
    if (!endpoint) throw new Error('No Earth Engine backend configured.');

    onProgress?.('Sending job to Earth Engine…');
    const res = await fetch(`${endpoint}/run`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job: job.id,
        params,
        area: { name: area.name, geojson: area.geojson, bbox: area.bbox },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Earth Engine backend returned ${res.status}. ${detail.slice(0, 180)}`);
    }

    onProgress?.('Reading results…');
    const data = await res.json();

    if (!data.tileUrl && !data.geojson) {
      throw new Error('The backend response contained neither `tileUrl` nor `geojson`.');
    }

    return {
      type: data.type ?? (data.tileUrl ? 'raster' : 'vector'),
      tileUrl: data.tileUrl,
      geojson: data.geojson,
      legend: data.legend?.length ? data.legend : legendFor(job),
      stats: data.stats ?? {},
      summary: data.summary ?? job.reading?.(data.stats ?? {}) ?? '',
      meta: { synthetic: false, endpoint },
    };
  },
};
