/**
 * Applying a template — the one place that turns a catalogue entry into
 * live state (page, elements, basemap, look, camera).
 *
 * Text that came from a template is marked `auto: true`. As soon as the
 * user edits it in the inspector the flag is cleared, so loading a study
 * area later can fill in titles without ever overwriting typed words.
 */

import { state, set, checkpoint } from '../core/store.js';
import { createElement } from '../layout/elements.js';
import { setBasemap, applyBasemapGroups, applyTerrain, applyLook, applyBuildingExtrusion, getMap, onStyleReady } from '../core/map.js';
import { templateById } from './catalog.js';

/** Build the element list for a template, tagging template text as auto. */
function buildElements(tpl) {
  return tpl.elements.map((spec) => {
    const elm = createElement(spec.type, spec);
    if (spec.text !== undefined) elm.auto = true;
    return elm;
  });
}

/**
 * Switch to a template.
 * @param {string} id
 * @param {{ keepPage?: boolean, keepElements?: boolean }} [opts]
 */
export function applyTemplate(id, opts = {}) {
  const tpl = templateById(id);
  if (!tpl) return null;

  checkpoint();

  const patch = {
    templateId: id,
    mapLook: { ...tpl.look },
    basemapGroups: { ...tpl.groups },
    terrain: Boolean(tpl.terrain),
    buildings3d: Boolean(tpl.buildings3d),
    selectedElementId: null,
    selectedLayerId: null,
  };
  if (!opts.keepPage) patch.page = { ...state.page, ...tpl.page };
  if (!opts.keepElements) patch.elements = buildElements(tpl);

  set(patch, { history: false });
  if (!opts.keepElements) syncAutoText();

  /* --- map side of the template ---------------------------------- */
  applyLook(state.mapLook);

  if (state.basemap !== tpl.basemap) {
    setBasemap(tpl.basemap);          // style.load re-applies groups + terrain
  } else {
    applyBasemapGroups(state.basemapGroups);
    applyTerrain(state.terrain);
  }
  applyBuildingExtrusion(state.buildings3d);

  const map = getMap();
  if (map && tpl.camera) {
    map.easeTo({ pitch: tpl.camera.pitch ?? 0, bearing: tpl.camera.bearing ?? 0, duration: 700 });
  } else if (map && (map.getPitch() || map.getBearing())) {
    map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
  }

  return tpl;
}

/**
 * Fill template-provided title/subtitle text from the loaded study area.
 * Only touches elements still flagged `auto`.
 */
export function syncAutoText() {
  const area = state.studyArea;
  if (!area) return;
  let changed = false;
  for (const elm of state.elements) {
    if (!elm.auto) continue;
    if (elm.type === 'title') { elm.text = area.name; changed = true; }
    if (elm.type === 'subtitle') {
      const tpl = templateById(state.templateId);
      const base = tpl?.elements.find((e) => e.type === 'subtitle')?.text ?? '';
      elm.text = base.includes('Study area') || !base ? `Study area: ${area.name}` : base;
      changed = true;
    }
  }
  return changed;
}

/** Re-apply everything map-side after a reload or an undo. */
export function reapplyMapState() {
  applyLook(state.mapLook);
  applyBasemapGroups(state.basemapGroups);
  applyTerrain(state.terrain);
  applyBuildingExtrusion(state.buildings3d);
}

/** Keep 3-D buildings alive across basemap swaps. */
export function watchBuildings3d() {
  onStyleReady(() => applyBuildingExtrusion(state.buildings3d));
}
