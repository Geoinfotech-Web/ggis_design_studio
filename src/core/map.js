/**
 * MapLibre controller.
 *
 * Owns the single map instance and everything style-level: basemap
 * switching, plain-English basemap group toggles, 3-D terrain and the
 * "look" filters that give templates their vintage / night / blueprint
 * character. Overlay data layers are added by layers/render.js, which
 * re-runs on every `style-ready` event because MapLibre discards custom
 * sources whenever the base style is replaced.
 */

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { BASEMAPS, BASEMAP_GROUPS, MAP_LOOKS, TERRAIN_SOURCE } from './constants.js';
import { state, set } from './store.js';
import { debounce } from './dom.js';

let map = null;
const styleReadyHandlers = new Set();

export const getMap = () => map;
export const isReady = () => Boolean(map && map.isStyleLoaded());

/** Run `fn` every time a base style finishes loading (including the first). */
export function onStyleReady(fn) {
  styleReadyHandlers.add(fn);
  if (isReady()) fn(map);
  return () => styleReadyHandlers.delete(fn);
}

function fireStyleReady() {
  for (const fn of styleReadyHandlers) {
    try { fn(map); } catch (err) { console.error('[map] style-ready handler failed', err); }
  }
}

/* ------------------------------------------------------------------ */
/* init                                                                */
/* ------------------------------------------------------------------ */
export function initMap(container = 'map') {
  if (map) return map;

  map = new maplibregl.Map({
    container,
    style: BASEMAPS[state.basemap].url,
    center: state.mapView.center,
    zoom: state.mapView.zoom,
    pitch: state.mapView.pitch,
    bearing: state.mapView.bearing,
    attributionControl: false,
    // Required so the WebGL buffer can be read back when exporting.
    preserveDrawingBuffer: true,
    maxPitch: 75,
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');

  map.on('style.load', () => {
    applyBasemapGroups(state.basemapGroups);
    applyTerrain(state.terrain);
    fireStyleReady();
  });

  const syncView = debounce(() => {
    const c = map.getCenter();
    set({ mapView: { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() } },
      { history: false });
  }, 220);
  map.on('moveend', syncView);
  map.on('pitchend', syncView);
  map.on('rotateend', syncView);

  applyLook(state.mapLook);
  // Dev-only handle so the live style can be inspected from the console.
  if (import.meta.env?.DEV) window.__map = map;
  return map;
}

/* ------------------------------------------------------------------ */
/* basemap                                                             */
/* ------------------------------------------------------------------ */
export function setBasemap(key) {
  if (!map || !BASEMAPS[key]) return;
  set({ basemap: key }, { history: false });
  map.setStyle(BASEMAPS[key].url);   // 'style.load' re-adds everything
}

/**
 * Hide/show whole families of basemap layers by matching their layer ids.
 * Users see "Roads & streets", not `transportation_name_ref`.
 */
export function applyBasemapGroups(groups) {
  if (!map || !map.getStyle()) return;
  const layers = map.getStyle().layers ?? [];
  for (const layer of layers) {
    if (layer.id.startsWith('gds-')) continue;         // our own overlays
    const id = layer.id.toLowerCase();
    for (const [group, { match }] of Object.entries(BASEMAP_GROUPS)) {
      if (groups[group] === undefined) continue;
      if (match.some((needle) => id.includes(needle))) {
        try { map.setLayoutProperty(layer.id, 'visibility', groups[group] ? 'visible' : 'none'); } catch { /* some layers refuse */ }
        break;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 3-D terrain                                                         */
/* ------------------------------------------------------------------ */
export function applyTerrain(on, exaggeration = 1.4) {
  if (!map || !map.isStyleLoaded()) return;
  try {
    if (on) {
      if (!map.getSource('gds-dem')) map.addSource('gds-dem', TERRAIN_SOURCE);
      map.setTerrain({ source: 'gds-dem', exaggeration });
      if (!map.getLayer('gds-hillshade')) {
        map.addLayer({
          id: 'gds-hillshade',
          type: 'hillshade',
          source: 'gds-dem',
          paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#334155' },
        });
      }
    } else {
      map.setTerrain(null);
      if (map.getLayer('gds-hillshade')) map.removeLayer('gds-hillshade');
    }
  } catch (err) {
    console.warn('[map] terrain unavailable', err);
  }
}

/** Extrude OSM buildings — the "3D city" templates use this. */
export function applyBuildingExtrusion(on, color = '#cbd5e1') {
  if (!map || !map.isStyleLoaded()) return;
  const id = 'gds-3d-buildings';
  try {
    if (!on) { if (map.getLayer(id)) map.removeLayer(id); return; }
    if (map.getLayer(id)) return;
    // OpenFreeMap ships OpenMapTiles schema: the `building` source-layer
    // carries render_height / render_min_height.
    map.addLayer({
      id,
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-extrusion-color': color,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.92,
        'fill-extrusion-vertical-gradient': true,
      },
    });
  } catch (err) {
    console.warn('[map] building extrusion unavailable for this basemap', err);
  }
}

/* ------------------------------------------------------------------ */
/* look (filters + vignette)                                           */
/* ------------------------------------------------------------------ */

/** The CSS filter string for the current look — export reuses this verbatim. */
export function lookFilter(look = state.mapLook) {
  return MAP_LOOKS[look?.filter]?.filter ?? 'none';
}

export function applyLook(look) {
  if (!map) return;
  const canvas = map.getCanvas();
  const filter = lookFilter(look);
  canvas.style.filter = filter === 'none' ? '' : filter;

  const tint = document.getElementById('map-tint');
  if (tint) {
    const v = Number(look?.vignette ?? 0);
    tint.style.opacity = v > 0 ? '1' : '0';
    tint.style.background = v > 0
      ? `radial-gradient(ellipse at 50% 50%, transparent ${Math.max(20, 70 - v * 45)}%, rgba(15,23,42,${(v * 0.55).toFixed(3)}) 100%)`
      : 'none';
  }
}

/* ------------------------------------------------------------------ */
/* camera helpers                                                      */
/* ------------------------------------------------------------------ */
export function flyToBounds(bounds, opts = {}) {
  if (!map || !bounds) return;
  map.fitBounds(bounds, { padding: 70, duration: 900, ...opts });
}

export function flyTo(view) {
  if (!map || !view) return;
  map.flyTo({
    center: view.center,
    zoom: view.zoom,
    pitch: view.pitch ?? 0,
    bearing: view.bearing ?? 0,
    essential: true,
    duration: 900,
  });
}

/** Redraw after a panel opens/closes so the artboard stays centred. */
export function resizeSoon(delay = 40) {
  setTimeout(() => map && map.resize(), delay);
}

export { maplibregl };
