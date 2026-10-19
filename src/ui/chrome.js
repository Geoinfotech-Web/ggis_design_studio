/**
 * Studio chrome — the header, the tool rail, the guided step strip, the
 * floating map controls and the footer.
 *
 * None of this holds state of its own; it reads the store and writes back
 * through it, which is what keeps the rail, the steps and the panels from
 * disagreeing about where the user is.
 */

import { $, $$, el, fill, debounce } from '../core/dom.js';
import { state, set, subscribe, undo, redo, canUndo, canRedo, saveProject, hasWork } from '../core/store.js';
import { notify } from '../core/toast.js';
import { APP, BASEMAPS, attributionFor, PAPER_SIZES, paperDimsLabel } from '../core/constants.js';
import { setBasemap, flyToBounds, getMap, resizeSoon } from '../core/map.js';
import { boundsFromBbox, formatArea, formatNumber } from '../core/geo.js';
import { initShortcuts, openShortcutHelp, kbd } from './shortcuts.js';
import { exportPng, exportPdf, thumbnailDataUrl } from '../export/render.js';
import { setTool } from './tool.js';
import { themeToggle } from './theme.js';
import { toolLocked, studioLocked, lockReason } from '../core/flow.js';
import { currentUser, initials } from '../core/auth.js';
import { uiIcon } from './ui-icons.js';
import {
  renderElements, layoutArtboard, paperDims, setPanMode, hint,
  isLayoutLocked, setLayoutLocked, zoomLayout, panLayout, fitLayout, layoutZoom, toggleGrid, toggleMapFrame,
} from './artboard.js';

/* ------------------------------------------------------------------ */
/* tool rail                                                           */
/* ------------------------------------------------------------------ */
/**
 * The rail, in the order a map is made. `also` lists panels that belong to a
 * rail item without having one of their own: the style, basemap and page
 * settings open from Start map, so the rail keeps Start map lit for them.
 */
const TOOLS = [
  { id: 'area',     label: 'Study area',   done: () => Boolean(state.studyArea),
    d: 'M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10zM12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
  { id: 'start',    label: 'Start map',    done: () => Boolean(state.mapStarted), also: ['templates'],
    d: 'M12 5v14M5 12h14' },
  { id: 'data',     label: 'Data',
    d: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' },
  { id: 'elements', label: 'Elements',
    d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'layers',   label: 'Layers',
    d: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5' },
  { id: 'projects', label: 'My projects',
    d: 'M3 7h6l2 2h10v10H3z' },
  { id: 'ai',       label: 'AI assistant',
    d: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z' },
  // Not a panel: opens the shortcut sheet over the studio, from any step.
  { id: 'shortcuts', label: 'Shortcuts', run: () => openShortcutHelp(), title: 'Keyboard shortcuts (?)',
    d: 'M4 6h16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 18H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 6zM6.5 10h1M10 10h1M13.5 10h1M17 10h.5M7 14h10' },
];

const railIcon = (d) => el('span.rail-ico', {
  html: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`,
});

const isActiveTool = (tool) => state.activeTool === tool.id || Boolean(tool.also?.includes(state.activeTool));

/* ------------------------------------------------------------------ */
/* narrow-screen sheets                                                */
/* ------------------------------------------------------------------ */

/**
 * Below this width the panels stop being columns and become sheets over the
 * map, so they need opening and closing — something the wide layout never
 * has to think about. The breakpoint is duplicated in studio.css; it is the
 * one number the two have to agree on.
 */
const narrow = () => window.matchMedia('(max-width: 760px)').matches;

const studioEl = () => $('#studio');

function setPanelOpen(open) {
  studioEl()?.classList.toggle('is-panel-open', open);
  resizeSoon();
}

function setInspectorOpen(open) {
  studioEl()?.classList.toggle('is-inspector-open', open);
  resizeSoon();
}

function renderRail() {
  const rail = $('#tool-rail');
  if (!rail) return;
  fill(rail, TOOLS.map((tool) => {
    if (tool.run) {
      const btn = el('button.rail-btn.rail-btn--util', { type: 'button', title: tool.title ?? tool.label }, [
        railIcon(tool.d), el('span', { text: tool.label }),
      ]);
      btn.addEventListener('click', tool.run);
      return btn;
    }
    const locked = toolLocked(tool.id);
    const active = isActiveTool(tool);
    const btn = el('button.rail-btn', {
      type: 'button',
      title: locked ? `${tool.label} — locked. ${lockReason()}` : tool.label,
      'aria-disabled': locked ? 'true' : null,
    }, [
      railIcon(tool.d),
      el('span', { text: tool.label }),
      locked ? el('span.rail-lock', { 'aria-hidden': 'true' }, [uiIcon('lock', 11)]) : null,
    ]);
    btn.classList.toggle('is-active', active);
    btn.classList.toggle('is-locked', locked);
    btn.classList.toggle('is-done', !active && !locked && Boolean(tool.done?.()));
    btn.addEventListener('click', () => {
      // On a phone the rail doubles as the panel's open/close control:
      // tapping the tool you are already in puts the map back.
      if (narrow() && active) {
        setPanelOpen(!studioEl()?.classList.contains('is-panel-open'));
        return;
      }
      // setTool() explains itself and redirects when the tool is locked.
      setTool(tool.id);
      if (narrow()) setPanelOpen(true);
    });
    return btn;
  }));
}

function showPane() {
  $$('.panel-pane').forEach((pane) => {
    pane.classList.toggle('is-active', pane.dataset.pane === state.activeTool);
  });
}

/* ------------------------------------------------------------------ */
/* guided steps                                                        */
/* ------------------------------------------------------------------ */
/**
 * The chain across the header: where you are in making the map. A filled node
 * is done, the solid one is where you are, and a dashed one is not ready yet —
 * the same reading as a model diagram, where a hollow step has not got its
 * inputs.
 */
let exported = false;
const STEPS = [
  { id: 'area',     label: 'Study area', tools: ['area'],                done: () => Boolean(state.studyArea) },
  { id: 'start',    label: 'Start map',  tools: ['start', 'templates'],  done: () => Boolean(state.mapStarted) },
  { id: 'data',     label: 'Data',       tools: ['data'],                done: () => state.layers.some((l) => l.source === 'osm' || l.source === 'overture' || l.source === 'upload') },
  { id: 'elements', label: 'Compose',    tools: ['elements', 'layers'],  done: () => exported },
  { id: 'export',   label: 'Export',     tools: [],                      done: () => exported },
];

function renderSteps() {
  const strip = $('#step-strip');
  if (!strip) return;
  const children = [];
  STEPS.forEach((step, i) => {
    const locked = step.id === 'export' ? studioLocked() : toolLocked(step.id);
    const active = step.tools.includes(state.activeTool);
    const li = el('li');
    const btn = el('button.step', { type: 'button', title: locked ? lockReason() : step.label }, [
      el('span', { text: step.label }),
    ]);
    btn.classList.toggle('is-active', active);
    btn.classList.toggle('is-done', !active && !locked && step.done());
    btn.classList.toggle('is-todo', locked);
    btn.addEventListener('click', () => {
      if (step.id !== 'export') { setTool(step.id); return; }
      if (studioLocked()) notify.info(lockReason(), { duration: 4200 });
      else runExport('pdf');
    });
    li.append(btn);
    children.push(li);
    if (i < STEPS.length - 1) children.push(el('li.step-sep', { 'aria-hidden': 'true', text: '→' }));
  });
  fill(strip, children);
}

/**
 * Everything that changes when the studio opens up or closes again: the
 * right-hand panel goes quiet, export waits, and a panel that has just
 * become unavailable hands over to the step that will reopen it.
 */
function syncLock() {
  const locked = studioLocked();
  studioEl()?.classList.toggle('is-locked', locked);
  const right = $('#right-panel');
  if (right) {
    if (locked) right.dataset.lock = lockReason();
    else delete right.dataset.lock;
  }
  for (const id of ['#export-png-btn', '#export-pdf-btn']) {
    const btn = $(id);
    if (btn) btn.disabled = locked;
  }
  if (toolLocked(state.activeTool)) set({ activeTool: state.studyArea ? 'start' : 'area' }, { history: false });
}

/* ------------------------------------------------------------------ */
/* map toolbar                                                         */
/* ------------------------------------------------------------------ */
/*
 * A narrow column of icon buttons down the map's right edge, the way a GIS
 * desktop docks its map tools. Each button names itself and its key in a
 * tooltip; the two that hold more open a flyout to the left, so nothing
 * covers the map until it is asked for.
 */
const TB_ICONS = {
  basemap: '<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="M2.5 12 12 17l9.5-5"/><path d="M2.5 16 12 21l9.5-5"/>',
  view: '<circle cx="12" cy="12" r="8.5"/><path d="m14.8 9.2-1.6 4-4 1.6 1.6-4z"/>',
  pan: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>',
  north: '<path d="M12 3 7 20l5-3.5 5 3.5z"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="m20.5 20.5-4.9-4.9M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="m20.5 20.5-4.9-4.9M8 11h6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7"/>',
  fitPage: '<rect x="6" y="3.5" width="12" height="17" rx="1.5"/><path d="M9 8h6M9 11h6M9 14h3"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>',
  mapframe: '<rect x="2.5" y="2.5" width="19" height="19" rx="1.5"/><rect x="6" y="6" width="12" height="10" rx="0.5"/><path d="M7.5 13.5l2.8-3 2.2 2 1.6-1.4 2.4 2.4"/>',
};

const hasGrid = () => state.elements.some((e) => e.type === 'grid');
const hasMapFrame = () => state.elements.some((e) => e.type === 'mapframe');

/** Map frame on or off — the toolbar button and the M key. */
function toggleMapFrameTool() {
  if (!state.mapStarted) { notify.info('Start your map first — the frame is drawn on the page.', { duration: 3600 }); return; }
  setFlyout(null);
  const on = toggleMapFrame();
  renderMapControls();
  if (on) hint('<b>Map frame on</b> — the map now shows only inside it. Drag its edge to move it, a corner to resize. Press <b>M</b> to remove it.', 5600);
}

/** Grid lines and labels on or off — the toolbar button and the G key. */
function toggleGridLines() {
  if (!state.mapStarted) { notify.info('Start your map first — the grid is drawn on the page.', { duration: 3600 }); return; }
  setFlyout(null);
  const on = toggleGrid();
  renderMapControls();
  if (on) hint('<b>Grid on</b> — style it on the right: interval, label format, which edges. Press <b>G</b> to remove it.', 5200);
}
const tbIcon = (name, size = 17) => el('span.tb-ico', {
  html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TB_ICONS[name]}</svg>`,
});

/** Which flyout is open: 'basemap', 'view' or null. Survives re-renders. */
let openFlyout = null;

function setFlyout(name) {
  openFlyout = name;
  for (const node of $$('#map-controls .tb-slot')) {
    const open = node.dataset.flyout === name;
    node.classList.toggle('is-open', open);
    node.querySelector('.tb-btn')?.setAttribute('aria-expanded', String(open));
  }
}

/** A toolbar button: icon only, with its name and key in a tooltip. */
function tbButton(icon, label, keys, onClick, { pressed, flyout } = {}) {
  const btn = el('button.tb-btn', {
    type: 'button', 'aria-label': label,
    ...(flyout ? { 'aria-haspopup': 'true', 'aria-expanded': String(openFlyout === flyout) } : {}),
    ...(pressed !== undefined ? { 'aria-pressed': String(pressed) } : {}),
  }, [
    tbIcon(icon),
    el('span.tb-tip', { role: 'presentation' }, [el('span', { text: label }), keys.length ? kbd(keys) : null]),
  ]);
  btn.addEventListener('click', onClick);
  return btn;
}

/* ---- view actions, shared by the menu and the keyboard ------------ */
/*
 * With the layout locked the map is fixed to the page, so the actions that
 * would move the map under it say so instead, and zoom/arrows move the
 * whole page — the same as the wheel and a drag do while locked.
 */
const lockedNote = () => notify.info('The layout is locked — the map stays framed. Press <b>L</b> to unlock and move the map itself.', { duration: 3600 });

function togglePan() {
  if (isLayoutLocked()) { lockedNote(); return; }
  const on = !state.panMode;
  setPanMode(on);
  if (on) hint('<b>Pan mode</b> — drag anywhere to move the map. Press <b>C</b> or <b>Esc</b> to arrange the page again.', 5200);
}
function fitArea() {
  if (isLayoutLocked()) { lockedNote(); return; }
  if (!state.studyArea) { notify.warn('No study area loaded yet.'); setTool('area'); return; }
  flyToBounds(boundsFromBbox(state.studyArea.bbox));
}
const northUp = () => { if (isLayoutLocked()) { lockedNote(); return; } getMap()?.easeTo({ bearing: 0, pitch: 0, duration: 500 }); };
const zoomBy = (d) => {
  if (isLayoutLocked()) { zoomLayout(2 ** (d * 0.5)); return; }
  const map = getMap();
  if (map) map.easeTo({ zoom: map.getZoom() + d, duration: 250 });
};
function panBy(key) {
  const step = 100;
  const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key] ?? [0, 0];
  // Locked, the arrow moves the view over the page, so the page goes the
  // other way.
  if (isLayoutLocked()) { panLayout(-dx, -dy); return; }
  getMap()?.panBy([dx, dy], { duration: 160 });
}
const rotateBy = (deg) => { if (isLayoutLocked()) { lockedNote(); return; } const map = getMap(); if (map) map.easeTo({ bearing: map.getBearing() + deg, duration: 250 }); };
const toggleLayoutLock = () => { setFlyout(null); setLayoutLocked(!isLayoutLocked()); };

/** The page zoom bar along the bottom of the canvas, shown while locked. */
function renderLayoutBar() {
  const wrap = $('#canvas-wrap');
  if (!wrap) return;
  let bar = wrap.querySelector('.layout-bar');
  if (!isLayoutLocked()) { bar?.remove(); return; }
  if (!bar) { bar = el('div.layout-bar', { role: 'toolbar', 'aria-label': 'Page zoom' }); wrap.append(bar); }
  const btn = (icon, label, keys, onClick, text) => {
    const b = el('button.lb-btn', { type: 'button', title: `${label}${keys ? ` (${keys})` : ''}`, 'aria-label': label }, [
      icon ? tbIcon(icon, 15) : null, text ? el('span', { text }) : null,
    ]);
    b.addEventListener('click', onClick);
    return b;
  };
  fill(bar, [
    el('span.lb-state', {}, [tbIcon('lock', 14), el('span', { text: 'Layout locked' })]),
    el('span.lb-rule'),
    btn('zoomOut', 'Zoom the page out', '−', () => zoomLayout(1 / 1.25)),
    el('span.lb-zoom', { text: `${Math.round(layoutZoom() * 100)}%`, title: 'Page zoom' }),
    btn('zoomIn', 'Zoom the page in', '+', () => zoomLayout(1.25)),
    btn('fitPage', 'Fit the page to the window', '0', () => fitLayout(), 'Fit'),
    el('span.lb-rule'),
    btn('unlock', 'Unlock the layout', 'L', () => setLayoutLocked(false), 'Unlock'),
  ]);
}

/**
 * One tile of a basemap, near the middle of the current view, as its
 * thumbnail in the gallery. Zoom 6 shows a region's coastline and towns,
 * which is what tells the basemaps apart at this size.
 */
function basemapThumb(base) {
  const template = (base.thumb ?? base.rasters?.[0]?.tiles)?.[0];
  if (!template) return '';
  const center = getMap()?.getCenter() ?? { lng: 8, lat: 9 };
  const z = Math.min(6, base.rasters?.[0]?.maxzoom ?? 6);
  const n = 2 ** z;
  const lat = Math.max(-85, Math.min(85, center.lat)) * Math.PI / 180;
  const x = Math.floor(((center.lng + 180) / 360) * n) % n;
  const y = Math.floor(((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * n);
  return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

function basemapFlyout() {
  const groups = new Map();
  for (const [key, base] of Object.entries(BASEMAPS)) {
    if (!groups.has(base.group)) groups.set(base.group, []);
    const thumb = basemapThumb(base);
    const option = el('button.basemap-option', { type: 'button', title: base.hint, 'aria-pressed': String(state.basemap === key) }, [
      el('span.basemap-thumb', {}, thumb ? [el('img', { src: thumb, alt: '', loading: 'lazy' })] : []),
      el('span.basemap-name', { text: base.label }),
    ]);
    option.classList.toggle('is-active', state.basemap === key);
    option.addEventListener('click', () => { setFlyout(null); setBasemap(key); });
    groups.get(base.group).push(option);
  }
  const more = el('button.flyout-link', { type: 'button', text: 'Style settings', title: 'Look, page and basemap layers, in the Map style panel (T)' });
  more.addEventListener('click', () => { setFlyout(null); setTool('templates'); });

  return el('div.tb-flyout.basemap-panel', { role: 'dialog', 'aria-label': 'Basemap gallery' }, [
    el('div.flyout-head', {}, [el('strong', { text: 'Basemap gallery' }), more]),
    ...[...groups].map(([name, options]) => el('div.basemap-group', {}, [
      el('div.flyout-section', { text: name }),
      el('div.basemap-grid', {}, options),
    ])),
  ]);
}

function viewFlyout() {
  const item = (icon, label, keys, onClick, pressed) => {
    const btn = el('button.view-item', { type: 'button', role: 'menuitem', ...(pressed !== undefined ? { 'aria-pressed': String(pressed) } : {}) }, [
      tbIcon(icon, 16), el('span.view-item-label', { text: label }), kbd(keys),
    ]);
    btn.classList.toggle('is-active', Boolean(pressed));
    btn.addEventListener('click', () => { setFlyout(null); onClick(); });
    return btn;
  };
  const bearing = Math.round(((getMap()?.getBearing() ?? 0) + 360) % 360);
  const pitch = Math.round(getMap()?.getPitch() ?? 0);
  return el('div.tb-flyout.view-panel', { role: 'menu', 'aria-label': 'View tools' }, [
    el('div.flyout-head', {}, [el('strong', { text: 'View tools' })]),
    item('pan', state.panMode ? 'Stop panning' : 'Pan mode', ['C'], togglePan, state.panMode),
    item('fit', 'Fit to study area', ['F'], fitArea),
    item('north', `North up${bearing || pitch ? ` · now ${bearing}°${pitch ? `, tilt ${pitch}°` : ''}` : ''}`, ['N'], northUp),
    el('div.flyout-rule'),
    item('zoomIn', 'Zoom in', ['+'], () => zoomBy(1)),
    item('zoomOut', 'Zoom out', ['−'], () => zoomBy(-1)),
  ]);
}

function slot(name, button, flyout) {
  const node = el('div.tb-slot', { dataset: { flyout: name } }, [button, flyout]);
  node.classList.toggle('is-open', openFlyout === name);
  return node;
}

function renderMapControls() {
  const host = $('#map-controls');
  if (!host) return;

  const basemapBtn = tbButton('basemap', `Basemap — ${(BASEMAPS[state.basemap] ?? BASEMAPS.liberty).label}`, ['B'],
    () => setFlyout(openFlyout === 'basemap' ? null : 'basemap'), { flyout: 'basemap' });
  const viewBtn = tbButton(state.panMode ? 'pan' : 'view', state.panMode ? 'View tools — pan mode is on' : 'View tools', ['V'],
    () => setFlyout(openFlyout === 'view' ? null : 'view'), { flyout: 'view' });
  viewBtn.classList.toggle('is-panning', state.panMode);
  const locked = isLayoutLocked();
  const lockBtn = tbButton(locked ? 'lock' : 'unlock', locked ? 'Unlock layout — move the map again' : 'Lock layout — zoom and move the whole page', ['L'],
    toggleLayoutLock, { pressed: locked });
  lockBtn.classList.toggle('is-locked', locked);
  const gridOn = hasGrid();
  const gridBtn = tbButton('grid', gridOn ? 'Grid & labels — on (click to remove)' : 'Grid & labels', ['G'], toggleGridLines, { pressed: gridOn });
  gridBtn.classList.toggle('is-on', gridOn);
  const frameOn = hasMapFrame();
  const frameBtn = tbButton('mapframe', frameOn ? 'Map frame — on (click to remove)' : 'Map frame', ['M'], toggleMapFrameTool, { pressed: frameOn });
  frameBtn.classList.toggle('is-on', frameOn);

  fill(host, [
    el('div.map-toolbar', { role: 'toolbar', 'aria-label': 'Map tools', 'aria-orientation': 'vertical' }, [
      slot('basemap', basemapBtn, basemapFlyout()),
      slot('view', viewBtn, viewFlyout()),
      frameBtn,
      gridBtn,
      lockBtn,
    ]),
  ]);
  renderLayoutBar();
}

// Clicking anywhere else, or Esc, folds the open flyout away.
document.addEventListener('pointerdown', (event) => {
  if (openFlyout && !event.target.closest?.('#map-controls .tb-slot.is-open')) setFlyout(null);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && openFlyout) setFlyout(null);
});

/* ------------------------------------------------------------------ */
/* cursor readout: position, zoom, scale and bearing                   */
/* ------------------------------------------------------------------ */
let coordFormat = 'dd';
let readout = null;
let lastPoint = null;

function dms(value, pos, neg) {
  const hemi = value >= 0 ? pos : neg;
  let v = Math.abs(value);
  const d = Math.floor(v); v = (v - d) * 60;
  const m = Math.floor(v); const s = (v - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″ ${hemi}`;
}

const formatPoint = ({ lng, lat }) => (coordFormat === 'dms'
  ? `${dms(lat, 'N', 'S')}  ${dms(lng, 'E', 'W')}`
  : `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lng).toFixed(5)}° ${lng >= 0 ? 'E' : 'W'}`);

/** Map scale at the centre of the view, as a printed ratio at 96 dpi. */
function scaleRatio(map) {
  const lat = map.getCenter().lat * Math.PI / 180;
  const metresPerPx = (40075016.686 * Math.cos(lat)) / (512 * 2 ** map.getZoom());
  const ratio = metresPerPx / 0.0254 * 96;
  const p = 10 ** Math.max(0, Math.floor(Math.log10(ratio)) - 2);
  return `1:${formatNumber(Math.round(ratio / p) * p, 0)}`;
}

function updateReadout() {
  const map = getMap();
  if (!readout || !map) return;
  const bearing = Math.round(((map.getBearing() % 360) + 360) % 360);
  readout.pos.textContent = lastPoint ? formatPoint(lastPoint) : '—';
  readout.zoom.textContent = `Z ${map.getZoom().toFixed(2)}`;
  readout.scale.textContent = scaleRatio(map);
  readout.bearing.textContent = `${bearing}°`;
  readout.bearing.parentElement.hidden = bearing === 0 && Math.round(map.getPitch()) === 0;
}

function ensureReadout() {
  if (readout) return readout.node;
  const pos = el('span.ro-pos', { text: '—' });
  const zoom = el('span');
  const scale = el('span');
  const bearing = el('span');
  const posBtn = el('button.ro-pos-btn', { type: 'button', title: 'Cursor position (WGS 84). Click or press D to switch decimal degrees / DMS.' }, [pos]);
  posBtn.addEventListener('click', () => toggleCoordFormat());
  const node = el('span.map-readout', {}, [
    posBtn,
    el('span.ro-item', { title: 'Zoom level' }, [zoom]),
    el('span.ro-item', { title: 'Map scale at the centre of the view, on screen at 96 dpi' }, [scale]),
    el('span.ro-item', { title: 'Bearing — press N for north up' }, [el('span', { text: 'Rot ' }), bearing]),
  ]);
  readout = { node, pos, zoom, scale, bearing };
  return node;
}

function toggleCoordFormat() {
  coordFormat = coordFormat === 'dd' ? 'dms' : 'dd';
  updateReadout();
  notify.info(coordFormat === 'dms' ? 'Coordinates in degrees, minutes and seconds.' : 'Coordinates in decimal degrees.', { duration: 1800 });
}

/** Hook the readout to the map once it exists; safe to call repeatedly. */
let mapHooked = false;
function hookMap() {
  const map = getMap();
  if (mapHooked || !map) return;
  mapHooked = true;
  // The window-level shortcuts drive the map now; MapLibre's own keys would
  // fire a second time whenever the canvas has focus.
  map.keyboard?.disable();
  map.on('mousemove', (e) => { lastPoint = e.lngLat; updateReadout(); });
  map.on('mouseout', () => { lastPoint = null; updateReadout(); });
  map.on('move', debounce(updateReadout, 30));
  // Bearing and pitch in the View flyout follow the map.
  map.on('rotateend', () => { if (openFlyout !== 'view') renderMapControls(); });
  map.on('pitchend', () => { if (openFlyout !== 'view') renderMapControls(); });
  updateReadout();
}

/* ------------------------------------------------------------------ */
/* footer                                                              */
/* ------------------------------------------------------------------ */
function renderFooter() {
  const footer = $('#studio-footer');
  if (!footer) return;
  const { label, orientation } = paperDims();
  const paper = PAPER_SIZES[state.page.size] ?? PAPER_SIZES.a4;
  const bits = [
    `${APP.name} ${APP.version}`,
    `${label} · ${paperDimsLabel(paper, orientation === 'portrait')} · ${state.page.dpi} dpi`,
    state.studyArea ? `${state.studyArea.name} · ${formatArea(state.studyArea.areaKm2)}` : 'No study area',
    `${state.layers.length} layer${state.layers.length === 1 ? '' : 's'}`,
    attributionFor(state.basemap),
  ];
  fill(footer, [ensureReadout(), ...bits.flatMap((text, i) => [
    i ? el('span.sep', { text: '·' }) : null,
    el('span', { text }),
  ]).filter(Boolean)]);
  hookMap();
  updateReadout();
}

/* ------------------------------------------------------------------ */
/* header                                                              */
/* ------------------------------------------------------------------ */
function renderHeader() {
  const undoBtn = $('#undo-btn');
  const redoBtn = $('#redo-btn');
  if (undoBtn) undoBtn.disabled = !canUndo();
  if (redoBtn) redoBtn.disabled = !canRedo();

  const subline = $('#project-subline');
  if (subline) {
    const { label, orientation } = paperDims();
    subline.textContent = `${label} ${orientation} · ${state.layers.length} layer${state.layers.length === 1 ? '' : 's'}`;
  }
}

async function runExport(kind) {
  const status = notify.busy(`Preparing your ${kind.toUpperCase()}…`);
  try {
    const fn = kind === 'pdf' ? exportPdf : exportPng;
    const out = await fn({ onProgress: (msg) => status.update(msg) });
    status.update(`<b>${kind.toUpperCase()} saved</b> — ${out.width} × ${out.height} px at ${state.page.dpi} dpi`, { tone: 'ok', duration: 5000 });
    exported = true;
    renderSteps();
  } catch (err) {
    console.error(err);
    status.update(`Export failed: ${err.message}`, { tone: 'error', duration: 8000 });
  }
}

/** Save into the project library, with a thumbnail for the home page. */
async function saveNow() {
  const status = notify.busy('Saving…');
  let thumbnail;
  try {
    if (state.elements.length) thumbnail = await thumbnailDataUrl();
  } catch { /* a project without a picture still saves */ }

  const result = saveProject({ thumbnail });
  if (result.ok) status.update(`<b>${state.projectName}</b> saved to your projects.`, { tone: 'ok', duration: 3500 });
  else status.update(result.error, { tone: 'error', duration: 9000 });
  return result;
}

function initHeader(onHome, onSignOut) {
  const name = $('#project-name');
  if (name) {
    name.value = state.projectName;
    name.addEventListener('input', () => set({ projectName: name.value }, { history: false }));
  }

  // A visible Save sits next to undo/redo so the project library is
  // discoverable; autosave and Ctrl+S write to the same place.
  const undoBtn = $('#undo-btn');
  if (undoBtn && !$('#save-btn')) {
    const save = el('button.icon-btn#save-btn', { type: 'button', title: 'Save to your projects (Ctrl+S)', 'aria-label': 'Save project', text: '⤓' });
    save.addEventListener('click', saveNow);
    undoBtn.before(save);
    undoBtn.before(themeToggle());
  }

  // Who is signed in, and the way out.
  const user = currentUser();
  const exportBtn = $('#export-pdf-btn');
  if (user && exportBtn && !$('#account-chip')) {
    const out = el('button.btn-ghost#sign-out-btn', { type: 'button', text: 'Sign out' });
    out.addEventListener('click', onSignOut);
    exportBtn.after(
      el('span.header-sep'),
      el('span.account-chip#account-chip', { title: `${user.name} · ${user.email}`, role: 'img', 'aria-label': `Signed in as ${user.name}`, text: initials(user) }),
      out,
    );
  }

  $('#back-home')?.addEventListener('click', onHome);
  $('#undo-btn')?.addEventListener('click', () => { if (undo()) { renderElements(); layoutArtboard(); } });
  $('#redo-btn')?.addEventListener('click', () => { if (redo()) { renderElements(); layoutArtboard(); } });
  $('#export-png-btn')?.addEventListener('click', () => runExport('png'));
  $('#export-pdf-btn')?.addEventListener('click', () => runExport('pdf'));

  window.addEventListener('keydown', (event) => {
    if (state.view !== 'studio') return;
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) { event.preventDefault(); if (undo()) { renderElements(); layoutArtboard(); } }
    else if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); if (redo()) { renderElements(); layoutArtboard(); } }
    else if (key === 's') { event.preventDefault(); saveNow(); }
    else if (key === 'e' && !event.shiftKey) { event.preventDefault(); exportIfOpen('pdf'); }
  });
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
/** Export from the keyboard, but only once the buttons would allow it. */
function exportIfOpen(kind) {
  if (studioLocked()) { notify.info(lockReason(), { duration: 4200 }); return; }
  runExport(kind);
}

export function initChrome({ onHome, onSignOut }) {
  initHeader(onHome, onSignOut);
  initShortcuts({
    togglePan, fitArea, northUp, zoom: zoomBy, panBy, rotate: rotateBy, toggleCoordFormat,
    toggleBasemap: () => setFlyout(openFlyout === 'basemap' ? null : 'basemap'),
    toggleView: () => setFlyout(openFlyout === 'view' ? null : 'view'),
    panel: (id) => { setFlyout(null); setTool(id); },
    exportPng: () => exportIfOpen('png'),
    help: () => { setFlyout(null); openShortcutHelp(); },
    toggleLayoutLock,
    fitPage: () => fitLayout(),
    toggleGrid: toggleGridLines,
    toggleMapFrame: toggleMapFrameTool,
  });
  renderRail();
  showPane();
  renderSteps();
  renderMapControls();
  renderFooter();
  renderHeader();
  syncLock();

  subscribe(['activeTool'], () => { renderRail(); showPane(); renderSteps(); resizeSoon(); });
  subscribe(['studyArea', 'mapStarted'], () => { syncLock(); renderRail(); renderSteps(); });
  subscribe(['basemap', 'panMode'], renderMapControls);
  // The page view changes on every step of a drag; only a change of lock
  // needs the toolbar rebuilt, the rest is the zoom bar's percentage.
  // The grid button shows whether a grid is on the page, which changes when
  // one is added or deleted from anywhere — but only rebuild when it does.
  let lastGrid = hasGrid();
  let lastFrame = hasMapFrame();
  subscribe(['elements'], () => {
    if (hasGrid() !== lastGrid || hasMapFrame() !== lastFrame) {
      lastGrid = hasGrid();
      lastFrame = hasMapFrame();
      renderMapControls();
    }
  });
  let lastLocked = isLayoutLocked();
  subscribe(['layoutView'], () => {
    if (isLayoutLocked() !== lastLocked) { lastLocked = isLayoutLocked(); renderMapControls(); } else renderLayoutBar();
  });

  // On a narrow screen the inspector is a sheet, so it has to be summoned by
  // the thing it inspects and dismissed when nothing is selected.
  subscribe(['selectedElementId', 'selectedLayerId'], () => {
    if (!narrow()) return;
    const selected = Boolean(state.selectedElementId || state.selectedLayerId);
    if (selected) setPanelOpen(false);
    setInspectorOpen(selected);
  });

  // Touching the map is how you get back to the map.
  $('#canvas-wrap')?.addEventListener('pointerdown', () => {
    if (!narrow()) return;
    setPanelOpen(false);
    setInspectorOpen(false);
  }, { capture: true });

  // Coming back to a wide window must not leave a sheet class behind.
  window.matchMedia('(max-width: 760px)').addEventListener('change', (e) => {
    if (e.matches) return;
    studioEl()?.classList.remove('is-panel-open', 'is-inspector-open');
    resizeSoon();
  });
  subscribe(['studyArea', 'layers', 'analysisRuns', 'elements', 'templateId', 'page'], () => {
    renderSteps();
    renderFooter();
    renderHeader();
  });
  subscribe(['history'], renderHeader);

  // Autosave — a refresh should never lose a design. It deliberately does
  // not *create* a project until there is something worth keeping, or
  // browsing the template gallery would litter the home page with stubs.
  const save = debounce(() => { if (hasWork()) saveProject(); }, 900);
  subscribe(['elements', 'page', 'layers', 'studyArea', 'templateId', 'mapLook', 'basemap', 'mapView', 'projectName', 'terrain', 'buildings3d', 'mapStarted'], save);
}
