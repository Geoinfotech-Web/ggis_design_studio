/**
 * Offline analysis provider — generates plausible, deterministic results
 * so the whole design workflow (styling, legends, stats cards, export)
 * can be built and demonstrated without Earth Engine credentials.
 *
 * Results are synthetic. Every layer and legend it produces is tagged
 * `synthetic: true`, and the UI labels them as demonstration data.
 * Swap in gee-provider.js for real numbers.
 */

import { legendFor } from './jobs.js';
import { pointInGeoJson } from '../core/geo.js';

/* --- deterministic value noise ------------------------------------ */
function hash2(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695040)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = (t) => t * t * (3 - 2 * t);

function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}

function fbm(x, y, seed, octaves = 4) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

/** Stable integer seed from a string. */
function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 100000;
}

/* --- grid construction -------------------------------------------- */
const MAX_CELLS = 1400;

function buildGrid(bbox, clipTo) {
  const [w, s, e, n] = bbox;
  const spanX = e - w, spanY = n - s;
  const aspect = spanX / Math.max(spanY, 1e-6);
  let cols = Math.round(Math.sqrt(MAX_CELLS * aspect));
  cols = Math.max(10, Math.min(46, cols));
  let rows = Math.max(8, Math.min(46, Math.round(cols / Math.max(aspect, 1e-6))));

  const dx = spanX / cols, dy = spanY / rows;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = w + c * dx, y0 = s + r * dy;
      const cx = x0 + dx / 2, cy = y0 + dy / 2;
      if (clipTo && !pointInGeoJson([cx, cy], clipTo)) continue;
      cells.push({ c, r, x0, y0, x1: x0 + dx, y1: y0 + dy, cx, cy });
    }
  }
  return { cells, cols, rows, dx, dy };
}

const cellPolygon = (cell) => ({
  type: 'Polygon',
  coordinates: [[[cell.x0, cell.y0], [cell.x1, cell.y0], [cell.x1, cell.y1], [cell.x0, cell.y1], [cell.x0, cell.y0]]],
});

/** Approximate ground area of one grid cell, km². */
function cellAreaKm2(dx, dy, lat) {
  return Math.abs(dx) * 111.32 * Math.cos((lat * Math.PI) / 180) * Math.abs(dy) * 110.57;
}

/* --- per-output-type generators ----------------------------------- */

function makeClassified(job, grid, seed, areaKm2Total) {
  const classes = job.classes ?? [];
  const tally = new Map();
  const features = [];

  for (const cell of grid.cells) {
    // Two noise fields so classes form coherent regions rather than static.
    const a = fbm(cell.c / 5.5, cell.r / 5.5, seed);
    const b = fbm(cell.c / 11 + 40, cell.r / 11 + 40, seed + 7);
    const mixed = a * 0.68 + b * 0.32;
    const idx = Math.min(classes.length - 1, Math.floor(mixed * classes.length));
    const klass = classes[idx];
    const km2 = cellAreaKm2(grid.dx, grid.dy, cell.cy);
    tally.set(klass.code, (tally.get(klass.code) ?? 0) + km2);
    features.push({
      type: 'Feature',
      geometry: cellPolygon(cell),
      properties: { class_code: klass.code, class_label: klass.label, _color: klass.color },
    });
  }

  const total = Array.from(tally.values()).reduce((s, v) => s + v, 0) || 1;
  const stats = {
    totalKm2: total,
    classes: classes
      .map((k) => ({ code: k.code, label: k.label, color: k.color, km2: tally.get(k.code) ?? 0, share: ((tally.get(k.code) ?? 0) / total) * 100 }))
      .filter((k) => k.km2 > 0)
      .sort((x, y) => y.km2 - x.km2),
    areaKm2: areaKm2Total,
  };
  return { features, stats };
}

function makeIndex(job, grid, seed) {
  const [lo, hi] = job.range ?? [0, 1];
  const ramp = job.ramp ?? ['#eff6ff', '#1d4ed8'];
  const features = [];
  let min = Infinity, max = -Infinity, sum = 0;

  for (const cell of grid.cells) {
    const t = fbm(cell.c / 7, cell.r / 7, seed) * 0.75 + fbm(cell.c / 2.4 + 9, cell.r / 2.4 + 9, seed + 3) * 0.25;
    const value = lo + t * (hi - lo);
    min = Math.min(min, value); max = Math.max(max, value); sum += value;
    const bucket = Math.min(ramp.length - 1, Math.floor(t * ramp.length));
    features.push({
      type: 'Feature',
      geometry: cellPolygon(cell),
      properties: { value: Number(value.toFixed(3)), bucket, _color: ramp[bucket] },
    });
  }

  const stats = {
    min, max,
    mean: sum / Math.max(features.length, 1),
    samples: features.length,
    unit: job.unit,
  };
  if (job.id === 'water-quality') {
    stats.waterKm2 = features.length * cellAreaKm2(grid.dx, grid.dy, grid.cells[0]?.cy ?? 0) * 0.22;
  }
  return { features, stats };
}

function makeMask(job, grid, seed, params, areaKm2Total) {
  const classes = job.classes ?? [];
  const sensitivity = Number(params.threshold ?? 3);
  // Higher sensitivity => lower cut-off => more detections.
  const cut = 0.78 - sensitivity * 0.045;
  const features = [];
  let hit = 0;
  const patchIds = new Set();

  for (const cell of grid.cells) {
    const v = fbm(cell.c / 4.2, cell.r / 4.2, seed);
    if (v < cut) continue;
    const strong = v > cut + 0.09;
    const edge = v < cut + 0.03;
    const klass = edge && classes[2] ? classes[2] : strong ? classes[0] : classes[1] ?? classes[0];
    hit++;
    patchIds.add(`${Math.floor(cell.c / 4)}:${Math.floor(cell.r / 4)}`);
    features.push({
      type: 'Feature',
      geometry: cellPolygon(cell),
      properties: { class_code: klass.code, class_label: klass.label, intensity: Number(v.toFixed(3)), _color: klass.color },
    });
  }

  const km2 = hit * cellAreaKm2(grid.dx, grid.dy, grid.cells[0]?.cy ?? 0);
  return {
    features,
    stats: {
      total: km2,
      patches: patchIds.size,
      share: areaKm2Total ? (km2 / areaKm2Total) * 100 : 0,
      cells: hit,
      areaKm2: areaKm2Total,
    },
  };
}

function makeChange(job, grid, seed, params, areaKm2Total) {
  const classes = job.classes ?? [];
  const features = [];
  let before = 0, gained = 0, lost = 0;

  for (const cell of grid.cells) {
    const base = fbm(cell.c / 6, cell.r / 6, seed);
    const later = fbm(cell.c / 6, cell.r / 6, seed + 21);
    const wasBuilt = base > 0.62;
    const isBuilt = base * 0.7 + later * 0.3 > 0.58;
    let klass = null;
    if (wasBuilt && isBuilt) { klass = classes[0]; before++; }
    else if (!wasBuilt && isBuilt) { klass = classes[1]; gained++; }
    else if (wasBuilt && !isBuilt) { klass = classes[2]; lost++; }
    if (!klass) continue;
    features.push({
      type: 'Feature',
      geometry: cellPolygon(cell),
      properties: { class_code: klass.code, class_label: klass.label, _color: klass.color },
    });
  }

  const per = cellAreaKm2(grid.dx, grid.dy, grid.cells[0]?.cy ?? 0);
  const baseKm2 = before * per;
  return {
    features,
    stats: {
      baselineKm2: baseKm2,
      gained: gained * per,
      lost: lost * per,
      growthPct: baseKm2 ? ((gained * per) / baseKm2) * 100 : 0,
      years: [params.from, params.to],
      areaKm2: areaKm2Total,
    },
  };
}

/* --- provider ------------------------------------------------------ */
export const mockProvider = {
  id: 'mock',
  label: 'Demo engine (offline)',
  description: 'Generates realistic synthetic results so you can design and export a full map without Earth Engine credentials.',
  synthetic: true,
  available: () => true,

  async run({ job, params, area }, { onProgress, signal } = {}) {
    onProgress?.('Building analysis grid…');
    await pause(180, signal);

    const seed = seedFrom(`${job.id}|${area.name}|${JSON.stringify(params)}`);
    const grid = buildGrid(area.bbox, area.geojson);
    if (!grid.cells.length) throw new Error('The study area is too small or thin to analyse. Pick a larger boundary.');

    onProgress?.(`Processing ${grid.cells.length.toLocaleString()} cells…`);
    await pause(320, signal);

    let out;
    switch (job.output) {
      case 'index':      out = makeIndex(job, grid, seed); break;
      case 'mask':       out = makeMask(job, grid, seed, params, area.areaKm2); break;
      case 'change':     out = makeChange(job, grid, seed, params, area.areaKm2); break;
      case 'classified':
      default:           out = makeClassified(job, grid, seed, area.areaKm2); break;
    }

    onProgress?.('Summarising results…');
    await pause(160, signal);

    return {
      type: 'vector',
      geojson: { type: 'FeatureCollection', features: out.features },
      legend: legendFor(job),
      stats: out.stats,
      summary: job.reading?.(out.stats) ?? '',
      meta: { synthetic: true, cells: grid.cells.length, grid: `${grid.cols}×${grid.rows}` },
    };
  },
};

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}
