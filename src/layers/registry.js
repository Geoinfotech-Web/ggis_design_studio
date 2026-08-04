/**
 * The layer registry — one flat, ordered list of everything drawn on top
 * of the basemap, whatever it came from (OSM, an upload, a boundary
 * lookup or an Earth Engine job). Panels, the legend element and the
 * export all read from this single list.
 */

import { state, set, touch } from '../core/store.js';
import { uid } from '../core/dom.js';
import { dominantGeometry, featureCount, bboxOf } from '../core/geo.js';

/** Sensible default paint for a newly added vector layer. */
export function defaultStyle(kind, color = '#0369a1') {
  return {
    fill: color,
    fillOpacity: kind === 'polygon' ? 0.35 : 0,
    stroke: kind === 'polygon' ? shade(color, -0.25) : color,
    strokeWidth: kind === 'line' ? 1.6 : 1.2,
    strokeOpacity: 1,
    dash: 'solid',            // solid | dashed | dotted
    radius: 4,                // point radius
    labelField: '',           // property name to label with
    labelSize: 11,
  };
}

/** Lighten (t>0) or darken (t<0) a hex colour. */
export function shade(hex, t) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return hex;
  const mix = (c) => {
    const v = parseInt(c, 16);
    const out = t >= 0 ? v + (255 - v) * t : v * (1 + t);
    return Math.max(0, Math.min(255, Math.round(out))).toString(16).padStart(2, '0');
  };
  return `#${mix(m[1])}${mix(m[2])}${mix(m[3])}`;
}

/**
 * Add a vector layer.
 * @param {object} spec
 * @param {string} spec.name
 * @param {object} spec.geojson
 * @param {'osm'|'upload'|'boundary'|'analysis'|'sample'} spec.source
 */
export function addVectorLayer(spec) {
  const kind = spec.kind ?? dominantGeometry(spec.geojson);
  const layer = {
    id: spec.id ?? uid('lyr'),
    name: spec.name ?? 'Untitled layer',
    source: spec.source ?? 'upload',
    type: 'vector',
    kind,
    geojson: spec.geojson,
    bbox: bboxOf(spec.geojson),
    visible: spec.visible ?? true,
    opacity: spec.opacity ?? 1,
    style: { ...defaultStyle(kind, spec.color ?? '#0369a1'), ...(spec.style ?? {}) },
    legend: spec.legend ?? [{ label: spec.name ?? 'Layer', color: spec.color ?? '#0369a1', swatch: kind }],
    meta: {
      count: featureCount(spec.geojson),
      addedAt: Date.now(),
      description: spec.description ?? '',
      ...(spec.meta ?? {}),
    },
  };
  set({ layers: [...state.layers, layer] }, { history: false });
  return layer;
}

/** Add a raster result layer (Earth Engine tiles, or any XYZ template). */
export function addRasterLayer(spec) {
  const layer = {
    id: spec.id ?? uid('lyr'),
    name: spec.name ?? 'Raster result',
    source: spec.source ?? 'analysis',
    type: 'raster',
    tileUrl: spec.tileUrl,
    visible: spec.visible ?? true,
    opacity: spec.opacity ?? 0.85,
    bbox: spec.bbox ?? null,
    style: {},
    legend: spec.legend ?? [],
    meta: { addedAt: Date.now(), description: spec.description ?? '', ...(spec.meta ?? {}) },
  };
  set({ layers: [...state.layers, layer] }, { history: false });
  return layer;
}

export const getLayer = (id) => state.layers.find((l) => l.id === id) ?? null;
export const findBySource = (source) => state.layers.filter((l) => l.source === source);
export const visibleLayers = () => state.layers.filter((l) => l.visible);

export function updateLayer(id, patch) {
  const layer = getLayer(id);
  if (!layer) return null;
  Object.assign(layer, patch);
  if (patch.style) layer.style = { ...layer.style, ...patch.style };
  touch('layers');
  return layer;
}

export function removeLayer(id) {
  set({ layers: state.layers.filter((l) => l.id !== id) }, { history: false });
}

export function toggleLayer(id, visible) {
  const layer = getLayer(id);
  if (!layer) return;
  layer.visible = visible ?? !layer.visible;
  touch('layers');
}

/** Move a layer up (+1, towards the top of the map) or down (-1). */
export function reorderLayer(id, delta) {
  const list = [...state.layers];
  const i = list.findIndex((l) => l.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  set({ layers: list }, { history: false });
}

/** Replace an existing layer that came from the same catalogue entry. */
export function replaceBySlug(slug, spec) {
  const existing = state.layers.find((l) => l.meta?.slug === slug);
  if (existing) removeLayer(existing.id);
  return addVectorLayer({ ...spec, meta: { ...(spec.meta ?? {}), slug } });
}

/** Every legend entry across visible layers, deduplicated by label+colour. */
export function collectLegend() {
  const seen = new Set();
  const out = [];
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    for (const item of layer.legend ?? []) {
      const key = `${item.label}|${item.color}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...item, layerId: layer.id });
    }
  }
  return out;
}
