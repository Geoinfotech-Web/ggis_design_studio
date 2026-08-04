/**
 * Projects the layer registry onto MapLibre.
 *
 * Strategy: tear down every `gds-ov-*` overlay and rebuild in registry
 * order. Overlay counts here are small (tens, not thousands), and a full
 * rebuild removes a whole category of "the map and the panel disagree"
 * bugs — including after a basemap swap, which wipes custom sources.
 */

import { getMap, onStyleReady } from '../core/map.js';
import { state, subscribe } from '../core/store.js';

const PREFIX = 'gds-ov-';

const DASH = {
  solid: undefined,
  dashed: [2.4, 1.6],
  dotted: [0.4, 1.6],
};

function teardown(map) {
  const style = map.getStyle();
  if (!style) return;
  for (const layer of style.layers ?? []) {
    if (layer.id.startsWith(PREFIX) && map.getLayer(layer.id)) map.removeLayer(layer.id);
  }
  for (const id of Object.keys(style.sources ?? {})) {
    if (id.startsWith(PREFIX) && map.getSource(id)) {
      try { map.removeSource(id); } catch { /* still referenced — next pass gets it */ }
    }
  }
}

function addVector(map, layer) {
  const srcId = `${PREFIX}${layer.id}`;
  map.addSource(srcId, { type: 'geojson', data: layer.geojson, generateId: true });

  const s = layer.style;
  const visibility = layer.visible ? 'visible' : 'none';
  const alpha = layer.opacity ?? 1;

  if (layer.kind === 'polygon') {
    map.addLayer({
      id: `${srcId}-fill`, type: 'fill', source: srcId, layout: { visibility },
      paint: { 'fill-color': s.fill, 'fill-opacity': (s.fillOpacity ?? 0.35) * alpha },
    });
  }

  if (layer.kind === 'polygon' || layer.kind === 'line') {
    map.addLayer({
      id: `${srcId}-line`, type: 'line', source: srcId,
      layout: { visibility, 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': s.stroke,
        'line-width': s.strokeWidth ?? 1.4,
        'line-opacity': (s.strokeOpacity ?? 1) * alpha,
        ...(DASH[s.dash] ? { 'line-dasharray': DASH[s.dash] } : {}),
      },
    });
  }

  if (layer.kind === 'point') {
    map.addLayer({
      id: `${srcId}-point`, type: 'circle', source: srcId, layout: { visibility },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, (s.radius ?? 4) * 0.6, 14, s.radius ?? 4],
        'circle-color': s.fill,
        'circle-opacity': alpha,
        'circle-stroke-width': s.strokeWidth ?? 1.2,
        'circle-stroke-color': s.stroke ?? '#ffffff',
      },
    });
  }

  if (s.labelField) {
    map.addLayer({
      id: `${srcId}-label`, type: 'symbol', source: srcId,
      layout: {
        visibility,
        'text-field': ['coalesce', ['get', s.labelField], ''],
        'text-size': s.labelSize ?? 11,
        'text-offset': layer.kind === 'point' ? [0, 1.1] : [0, 0],
        'text-anchor': layer.kind === 'point' ? 'top' : 'center',
        'text-allow-overlap': false,
      },
      paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.3 },
    });
  }
}

function addRaster(map, layer) {
  if (!layer.tileUrl) return;
  const srcId = `${PREFIX}${layer.id}`;
  map.addSource(srcId, { type: 'raster', tiles: [layer.tileUrl], tileSize: 256 });
  map.addLayer({
    id: `${srcId}-raster`, type: 'raster', source: srcId,
    layout: { visibility: layer.visible ? 'visible' : 'none' },
    paint: { 'raster-opacity': layer.opacity ?? 0.85 },
  });
}

/** Rebuild every overlay from the registry. */
export function syncLayers() {
  const map = getMap();
  if (!map || !map.isStyleLoaded()) return;
  teardown(map);
  for (const layer of state.layers) {
    try {
      if (layer.type === 'raster') addRaster(map, layer);
      else addVector(map, layer);
    } catch (err) {
      console.error(`[layers] could not render "${layer.name}"`, err);
    }
  }
}

/** Wire the registry to the map. Call once at boot. */
export function initLayerRendering() {
  onStyleReady(syncLayers);
  subscribe(['layers'], syncLayers);
}
