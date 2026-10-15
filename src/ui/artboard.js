/**
 * The artboard — the printable page floating over the map.
 *
 * Owns three things: the page rectangle's geometry on screen, the DOM for
 * every element inside it, and the drag / resize / snap interaction. All
 * element coordinates are percentages of the artboard, which is what lets
 * the same numbers drive a 96 dpi preview and a 300 dpi export.
 */

import { $, el } from '../core/dom.js';
import { state, set, touch, checkpoint, subscribe } from '../core/store.js';
import { PAPER_SIZES, paperDimsLabel } from '../core/constants.js';
import { renderElementDom, elementLabel, zoomInsetView, createElement } from '../layout/elements.js';
import { currentMetresPerPixel } from '../layout/derive.js';
import { notify } from '../core/toast.js';
import { getMap } from '../core/map.js';

let artboard, layer, label, wrap;
const nodes = new Map();          // element id → .el node
let dragging = null;
let guides = [];

const SNAP_TOLERANCE = 0.55;      // percent of artboard
const HANDLES = ['nw', 'ne', 'sw', 'se'];

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

/** Page dimensions in inches, honouring orientation. */
export function paperDims(page = state.page) {
  const paper = PAPER_SIZES[page.size] ?? PAPER_SIZES.a4;
  const orientation = paper.fixedOrientation ?? page.orientation;
  const portrait = orientation === 'portrait';
  const long = Math.max(paper.wIn, paper.hIn);
  const short = Math.min(paper.wIn, paper.hIn);
  return { wIn: portrait ? short : long, hIn: portrait ? long : short, label: paper.label, orientation };
}

/** The artboard rectangle in canvas-wrap pixels. */
export function artboardRect() {
  if (!artboard) return { x: 0, y: 0, w: 0, h: 0 };
  // From the style, not offsetLeft/offsetWidth: those are whole pixels, and
  // the layout view keeps the map aligned to this rectangle step by step —
  // rounding on every step would let the two drift apart.
  const px = (v, fallback) => (v ? parseFloat(v) : fallback);
  return {
    x: px(artboard.style.left, artboard.offsetLeft),
    y: px(artboard.style.top, artboard.offsetTop),
    w: px(artboard.style.width, artboard.offsetWidth),
    h: px(artboard.style.height, artboard.offsetHeight),
  };
}

/** Unit function: element style numbers → screen pixels. */
const unit = () => {
  const w = artboard?.offsetWidth || 600;
  return (pt) => (pt ?? 0) * 0.001 * w;
};

/**
 * Screen pixels per millimetre of printed page.
 *
 * The bridge between a line weight the user states in millimetres and the
 * pixels MapLibre paints in. It moves whenever the paper size or the window
 * does, which is why layers/render.js re-syncs on both — a stored 0.5 mm has
 * to keep meaning 0.5 mm of paper, not the pixel count it happened to be when
 * the window was that wide.
 */
export function pagePxPerMm() {
  const w = artboard?.offsetWidth;
  if (!w) return 3.3;
  const { wIn } = paperDims();
  return w / (wIn * 25.4);
}

/** Size and centre the page over the map. */
export function layoutArtboard() {
  if (!artboard || !wrap) return;
  const { wIn, hIn, label: paperLabel, orientation } = paperDims();
  const aspect = wIn / hIn;

  const availW = wrap.clientWidth - 96;
  const availH = wrap.clientHeight - 84;
  let w = Math.max(160, availW);
  let h = w / aspect;
  if (h > availH) { h = Math.max(140, availH); w = h * aspect; }

  // The layout view scales and shifts the fitted page.
  w *= layoutView.zoom;
  h *= layoutView.zoom;
  artboard.style.width = `${w.toFixed(2)}px`;
  artboard.style.height = `${h.toFixed(2)}px`;
  artboard.style.left = `${((wrap.clientWidth - w) / 2 + layoutView.dx).toFixed(2)}px`;
  artboard.style.top = `${((wrap.clientHeight - h) / 2 + layoutView.dy).toFixed(2)}px`;

  if (label) {
    const paper = PAPER_SIZES[state.page.size] ?? PAPER_SIZES.a4;
    const zoomNote = layoutView.zoom !== 1 ? ` · ${Math.round(layoutView.zoom * 100)}%` : '';
    label.textContent = `${paperLabel} ${orientation} · ${paperDimsLabel(paper, orientation === 'portrait')} · ${state.page.dpi} dpi${zoomNote}`;
  }
}

/**
 * Grid lines follow the map while it moves, not just after it settles.
 * Only grid elements are redrawn, once per frame — the rest of the page
 * still waits for the camera to stop.
 */
function initLiveGrid() {
  const map = getMap();
  if (!map) return;
  let frame = 0;
  const redraw = () => {
    frame = 0;
    const grids = state.elements.filter((e) => e.type === 'grid' && !e.hidden);
    if (!grids.length) return;
    const ctx = { u: unit(), mPerPx: currentMetresPerPixel(), artW: artboard.offsetWidth };
    for (const elm of grids) {
      const inner = nodes.get(elm.id)?.querySelector('.el-inner');
      if (inner) renderElementDom(inner, elm, ctx);
    }
  };
  map.on('move', () => { if (!frame) frame = requestAnimationFrame(redraw); });
  // A settled camera always gets a final, exact pass even if no frame ran.
  map.on('moveend', () => { cancelAnimationFrame(frame); redraw(); });
}

/** Add a grid over the map frame, or remove it if there is one. */
export function toggleGrid() {
  const existing = state.elements.find((e) => e.type === 'grid');
  if (existing) {
    removeElement(existing.id);
    renderElements();
    return false;
  }
  // Over the map frame when the page has one; otherwise inset from the page
  // edge, leaving the margin its labels sit in outside the frame. It goes to
  // the bottom of the stack, so title bands and panels sit on top.
  const frame = state.elements.find((e) => e.type === 'neatline');
  const box = frame ? { x: frame.x, y: frame.y, w: frame.w, h: frame.h } : { x: 4, y: 4, w: 92, h: 92 };
  checkpoint();
  const elm = createElement('grid', box);
  set({ elements: [elm, ...state.elements], selectedElementId: elm.id, selectedLayerId: null }, { history: false });
  renderElements();
  return true;
}

/* ------------------------------------------------------------------ */
/* layout view: zoom and move the whole page, map and all              */
/* ------------------------------------------------------------------ */
/*
 * Like a layout view in a desktop GIS. The page is drawn bigger or smaller
 * and the map under it is zoomed by exactly the same factor about the same
 * point, so what the page shows of the map never changes — only how large
 * it is on screen. That is what lets small text, a legend or an inset be
 * looked at closely and edited, without disturbing the map's framing.
 *
 * Locking the layout hands the mouse to this view: the wheel zooms the page
 * and dragging empty space moves it, while the map's own pan and zoom are
 * switched off so nothing can slide the map out from under the page.
 */
const layoutView = { zoom: 1, dx: 0, dy: 0 };
let layoutLocked = false;
const LAYOUT_MIN = 0.25;
const LAYOUT_MAX = 8;

export const isLayoutLocked = () => layoutLocked;
export const layoutZoom = () => layoutView.zoom;

const mapRef = () => getMap();

/**
 * Move to a new layout view, carrying the map along. `anchor` is the point
 * (canvas-wrap pixels) that stays still while zooming; default is the page
 * centre.
 */
export function setLayoutView({ zoom = layoutView.zoom, dx, dy } = {}, anchor = null) {
  if (!artboard || !wrap) return;
  const before = artboardRect();
  const z = Math.min(LAYOUT_MAX, Math.max(LAYOUT_MIN, zoom));
  const s = z / layoutView.zoom;

  if (dx === undefined && dy === undefined) {
    // Zoom about the anchor: the page point under it stays under it.
    const a = anchor ?? { x: before.x + before.w / 2, y: before.y + before.h / 2 };
    const nw = before.w * s;
    const nh = before.h * s;
    const nx = a.x - (a.x - before.x) * s;
    const ny = a.y - (a.y - before.y) * s;
    layoutView.dx = nx + nw / 2 - wrap.clientWidth / 2;
    layoutView.dy = ny + nh / 2 - wrap.clientHeight / 2;
  } else {
    layoutView.dx = dx ?? layoutView.dx;
    layoutView.dy = dy ?? layoutView.dy;
  }
  layoutView.zoom = z;
  layoutArtboard();
  const after = artboardRect();

  // The map follows: the place that was at the page's centre goes to the
  // new page centre, zoomed by the same factor.
  const map = mapRef();
  if (map && before.w > 0) {
    const geo = map.unproject([before.x + before.w / 2, before.y + before.h / 2]);
    const cx = wrap.clientWidth / 2;
    const cy = wrap.clientHeight / 2;
    map.jumpTo({ center: geo, zoom: map.getZoom() + Math.log2(after.w / before.w) });
    map.panBy([cx - (after.x + after.w / 2), cy - (after.y + after.h / 2)], { animate: false });
  }
  renderElements();
  touch('layoutView');
}

export const zoomLayout = (factor, anchor) => setLayoutView({ zoom: layoutView.zoom * factor }, anchor);
export const panLayout = (ddx, ddy) => setLayoutView({ dx: layoutView.dx + ddx, dy: layoutView.dy + ddy });
export const fitLayout = () => {
  if (layoutView.zoom === 1 && !layoutView.dx && !layoutView.dy) return;
  setLayoutView({ zoom: 1 });
  setLayoutView({ dx: 0, dy: 0 });
};

/** The current view, so an export can fit the page and put it back after. */
export const layoutViewSnapshot = () => ({ ...layoutView });
export function restoreLayoutView(snap) {
  if (!snap) return;
  setLayoutView({ zoom: snap.zoom });
  setLayoutView({ dx: snap.dx, dy: snap.dy });
}

export function setLayoutLocked(on) {
  layoutLocked = Boolean(on);
  const map = mapRef();
  if (map) {
    for (const handler of ['scrollZoom', 'dragPan', 'dragRotate', 'doubleClickZoom', 'touchZoomRotate', 'boxZoom']) {
      map[handler]?.[layoutLocked ? 'disable' : 'enable']();
    }
  }
  $('#studio')?.classList.toggle('is-layout-locked', layoutLocked);
  if (layoutLocked) hint('<b>Layout locked</b> — scroll to zoom the page, drag empty space to move it. Elements stay editable. Press <b>L</b> to unlock.', 5600);
  touch('layoutView');
}

function initLayoutView() {
  // Wheel over the canvas zooms the page while locked. Capture phase, so it
  // is decided before MapLibre or an inset sees the event.
  wrap.addEventListener('wheel', (event) => {
    if (!layoutLocked) return;
    if (event.target.closest?.('.map-controls, .layout-bar, .maplibregl-ctrl')) return;
    // An inset being panned keeps its own wheel.
    if (insetEditId && event.target.closest?.('.el.is-inset-editing')) return;
    event.preventDefault();
    event.stopPropagation();
    const r = wrap.getBoundingClientRect();
    const factor = Math.exp(-Math.max(-60, Math.min(60, event.deltaY)) * 0.0045);
    zoomLayout(factor, { x: event.clientX - r.left, y: event.clientY - r.top });
  }, { passive: false, capture: true });

  // Dragging empty space (map or scrim, not an element or a control) moves
  // the page while locked.
  wrap.addEventListener('pointerdown', (event) => {
    if (!layoutLocked || event.button !== 0) return;
    if (event.target.closest?.('.el, .map-controls, .layout-bar, .maplibregl-ctrl')) return;
    let lastX = event.clientX;
    let lastY = event.clientY;
    wrap.classList.add('is-layout-dragging');
    const move = (e) => {
      panLayout(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      wrap.classList.remove('is-layout-dragging');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  });
}

/* ------------------------------------------------------------------ */
/* element DOM                                                         */
/* ------------------------------------------------------------------ */

/**
 * Elements that are an outline around the map rather than a thing on it. A
 * neatline covers the whole page, and if its inside took the pointer the map
 * underneath could not be panned or zoomed at all. So only its edge is the
 * element: grab the line to move or select it, and everything inside the
 * line belongs to the map.
 */
// The grid too: it usually covers the whole map frame, and the map under it
// must still pan and zoom.
const FRAME_TYPES = new Set(['neatline', 'grid']);
const EDGES = ['top', 'right', 'bottom', 'left'];

function buildNode(elm) {
  const frame = FRAME_TYPES.has(elm.type);
  const node = el(frame ? 'div.el.el--frame' : 'div.el', { dataset: { id: elm.id, type: elm.type } }, [
    el('div.el-tag', { text: elementLabel(elm) }),
    el('div.el-inner'),
    ...(frame ? EDGES.map((edge) => el('div.el-edge', { dataset: { edge } })) : []),
    ...HANDLES.map((h) => el('div.el-handle', { dataset: { h } })),
  ]);
  node.addEventListener('pointerdown', (e) => onPointerDown(e, elm.id));
  if (elm.type === 'inset') {
    node.addEventListener('dblclick', (e) => {
      if (e.target.closest('.el-handle')) return;
      setInsetEditing(insetEditId === elm.id ? null : elm.id);
    });
    node.addEventListener('wheel', (e) => onInsetWheel(e, elm.id), { passive: false });
  }
  return node;
}

/* ------------------------------------------------------------------ */
/* inset view editing: pan and zoom the map inside a locator inset      */
/* ------------------------------------------------------------------ */
let insetEditId = null;
let insetPan = null;

export const insetEditingId = () => insetEditId;

/**
 * Put an inset into view-editing mode (drag pans its map, the wheel zooms
 * it) or take it out with null. Selecting anything else ends it.
 */
export function setInsetEditing(id) {
  insetEditId = id;
  if (id && state.selectedElementId !== id) selectElement(id);
  for (const [nid, node] of nodes) node.classList.toggle('is-inset-editing', nid === id);
  if (id) hint('<b>Editing the inset view</b> — drag to pan, scroll to zoom. Double-click or press <b>Esc</b> when done.', 5200);
  touch('insetEditing');
}

function insetContentRect(id) {
  const view = nodes.get(id)?.querySelector('.inset-view');
  const r = view?.getBoundingClientRect();
  return r && r.width > 2 && r.height > 2 ? r : null;
}

function onInsetWheel(event, id) {
  if (insetEditId !== id) return;
  const elm = state.elements.find((e) => e.id === id);
  const r = insetContentRect(id);
  if (!elm || !r) return;
  event.preventDefault();
  const about = [(event.clientX - r.left) / r.width - 0.5, (event.clientY - r.top) / r.height - 0.5];
  const steps = event.deltaY < 0 ? 0.25 : -0.25;
  updateElement(id, { style: zoomInsetView(elm.style, steps, about) }, { history: false });
}

function startInsetPan(event, elm, node) {
  const r = insetContentRect(elm.id);
  if (!r) return false;
  insetPan = {
    id: elm.id, startX: event.clientX, startY: event.clientY,
    origin: [...(elm.style.viewPan ?? [0, 0])], w: r.width, h: r.height, moved: false, frame: 0,
  };
  node.setPointerCapture(event.pointerId);
  node.classList.add('is-inset-dragging');
  const move = (e) => {
    const p = insetPan;
    if (!p) return;
    p.pan = [p.origin[0] + (e.clientX - p.startX) / p.w, p.origin[1] + (e.clientY - p.startY) / p.h];
    if (!p.moved) { p.moved = true; checkpoint(); }
    // One repaint per frame however fast the pointer reports.
    cancelAnimationFrame(p.frame);
    p.frame = requestAnimationFrame(() => apply(p));
  };
  const apply = (p) => updateElement(p.id, { style: { viewPan: p.pan.map((v) => Number(v.toFixed(4))) } }, { history: false });
  const up = () => {
    window.removeEventListener('pointermove', move);
    node.classList.remove('is-inset-dragging');
    // The last position always lands, even if its frame never came.
    if (insetPan?.moved) { cancelAnimationFrame(insetPan.frame); apply(insetPan); }
    insetPan = null;
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
  return true;
}

function positionNode(node, elm) {
  node.style.left = `${elm.x}%`;
  node.style.top = `${elm.y}%`;
  node.style.width = `${elm.w}%`;
  node.style.height = `${elm.h}%`;
}

/** Rebuild the element layer from state. */
export function renderElements() {
  if (!layer) return;
  const u = unit();
  const ctx = { u, mPerPx: currentMetresPerPixel(), artW: artboard.offsetWidth };
  const seen = new Set();

  state.elements.forEach((elm, index) => {
    seen.add(elm.id);
    let node = nodes.get(elm.id);
    if (!node) {
      node = buildNode(elm);
      nodes.set(elm.id, node);
      layer.append(node);
    }
    node.style.zIndex = String(index + 1);
    node.classList.toggle('is-selected', elm.id === state.selectedElementId);
    node.classList.toggle('is-inset-editing', elm.id === insetEditId);
    node.classList.toggle('is-locked', Boolean(elm.locked));
    node.style.display = elm.hidden ? 'none' : '';
    node.querySelector('.el-tag').textContent = elementLabel(elm);
    positionNode(node, elm);
    if (!elm.hidden) renderElementDom(node.querySelector('.el-inner'), elm, ctx);
  });

  for (const [id, node] of nodes) {
    if (!seen.has(id)) { node.remove(); nodes.delete(id); }
  }
}

/* ------------------------------------------------------------------ */
/* selection                                                           */
/* ------------------------------------------------------------------ */
export function selectElement(id) {
  if (state.selectedElementId === id) return;
  set({ selectedElementId: id, selectedLayerId: null }, { history: false });
}

/* ------------------------------------------------------------------ */
/* snapping                                                            */
/* ------------------------------------------------------------------ */
function snapTargets(exceptId) {
  const v = [0, 50, 100];
  const h = [0, 50, 100];
  for (const other of state.elements) {
    if (other.id === exceptId || other.hidden) continue;
    v.push(other.x, other.x + other.w / 2, other.x + other.w);
    h.push(other.y, other.y + other.h / 2, other.y + other.h);
  }
  return { v, h };
}

function nearest(value, candidates) {
  let best = null;
  for (const c of candidates) {
    const d = Math.abs(value - c);
    if (d <= SNAP_TOLERANCE && (best === null || d < Math.abs(value - best))) best = c;
  }
  return best;
}

function clearGuides() {
  guides.forEach((g) => g.remove());
  guides = [];
}

function drawGuide(axis, pct) {
  const g = el(`div.snap-guide.snap-guide--${axis}`);
  if (axis === 'v') g.style.left = `${pct}%`;
  else g.style.top = `${pct}%`;
  artboard.append(g);
  guides.push(g);
}

/** Snap an element's box, returning the adjusted box and the guides to show. */
function applySnap(box, exceptId, mode) {
  const { v, h } = snapTargets(exceptId);
  const shown = [];

  const edgesX = mode === 'move'
    ? [['x', box.x], ['cx', box.x + box.w / 2], ['r', box.x + box.w]]
    : [['x', box.x], ['r', box.x + box.w]];
  for (const [kind, value] of edgesX) {
    const hit = nearest(value, v);
    if (hit === null) continue;
    const delta = hit - value;
    if (mode === 'move') box.x += delta;
    else if (kind === 'x') { box.x += delta; box.w -= delta; }
    else box.w += delta;
    shown.push(['v', hit]);
    break;
  }

  const edgesY = mode === 'move'
    ? [['y', box.y], ['cy', box.y + box.h / 2], ['b', box.y + box.h]]
    : [['y', box.y], ['b', box.y + box.h]];
  for (const [kind, value] of edgesY) {
    const hit = nearest(value, h);
    if (hit === null) continue;
    const delta = hit - value;
    if (mode === 'move') box.y += delta;
    else if (kind === 'y') { box.y += delta; box.h -= delta; }
    else box.h += delta;
    shown.push(['h', hit]);
    break;
  }

  return { box, shown };
}

/* ------------------------------------------------------------------ */
/* drag + resize                                                       */
/* ------------------------------------------------------------------ */
function onPointerDown(event, id) {
  const elm = state.elements.find((e) => e.id === id);
  if (!elm) return;
  event.stopPropagation();
  selectElement(id);
  if (elm.locked || event.button !== 0) return;

  const handle = event.target.closest('.el-handle')?.dataset.h ?? null;
  const rect = artboardRect();
  const node = nodes.get(id);

  // An inset in view-editing mode pans its own map instead of moving.
  if (!handle && insetEditId === id && startInsetPan(event, elm, node)) return;

  dragging = {
    id, handle, node,
    startX: event.clientX,
    startY: event.clientY,
    origin: { x: elm.x, y: elm.y, w: elm.w, h: elm.h },
    rect,
    moved: false,
  };

  node.setPointerCapture(event.pointerId);
  node.classList.add('is-dragging');
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
}

function onPointerMove(event) {
  if (!dragging) return;
  const { rect, origin, handle } = dragging;
  const dx = ((event.clientX - dragging.startX) / rect.w) * 100;
  const dy = ((event.clientY - dragging.startY) / rect.h) * 100;
  if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) dragging.moved = true;

  let box;
  if (!handle) {
    box = { x: origin.x + dx, y: origin.y + dy, w: origin.w, h: origin.h };
  } else {
    box = { ...origin };
    if (handle.includes('w')) { box.x = origin.x + dx; box.w = origin.w - dx; }
    if (handle.includes('e')) { box.w = origin.w + dx; }
    if (handle.includes('n')) { box.y = origin.y + dy; box.h = origin.h - dy; }
    if (handle.includes('s')) { box.h = origin.h + dy; }
    box.w = Math.max(3, box.w);
    box.h = Math.max(1.6, box.h);
  }

  clearGuides();
  if (!event.altKey) {
    const { box: snapped, shown } = applySnap(box, dragging.id, handle ? 'resize' : 'move');
    box = snapped;
    shown.forEach(([axis, pct]) => drawGuide(axis, pct));
  }

  // Keep at least a sliver on the page.
  box.x = Math.min(Math.max(box.x, -box.w + 4), 96);
  box.y = Math.min(Math.max(box.y, -box.h + 2), 98);

  dragging.box = box;
  positionNode(dragging.node, box);
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove);
  clearGuides();
  if (!dragging) return;
  const { id, node, box, moved } = dragging;
  node.classList.remove('is-dragging');

  if (moved && box) {
    checkpoint();
    const elm = state.elements.find((e) => e.id === id);
    if (elm) {
      Object.assign(elm, {
        x: Number(box.x.toFixed(2)), y: Number(box.y.toFixed(2)),
        w: Number(box.w.toFixed(2)), h: Number(box.h.toFixed(2)),
      });
      touch('elements');
    }
  }
  dragging = null;
}

/* ------------------------------------------------------------------ */
/* element operations used by the panels                               */
/* ------------------------------------------------------------------ */
export function addElement(elm, { select = true } = {}) {
  checkpoint();
  set({ elements: [...state.elements, elm] }, { history: false });
  if (select) selectElement(elm.id);
  return elm;
}

export function updateElement(id, patch, { history = true } = {}) {
  const elm = state.elements.find((e) => e.id === id);
  if (!elm) return;
  if (history) checkpoint();
  const { style, ...rest } = patch;
  Object.assign(elm, rest);
  if (style) elm.style = { ...elm.style, ...style };
  touch('elements');
}

export function removeElement(id) {
  checkpoint();
  set({ elements: state.elements.filter((e) => e.id !== id) }, { history: false });
  if (state.selectedElementId === id) set({ selectedElementId: null }, { history: false });
}

export function reorderElement(id, delta) {
  const list = [...state.elements];
  const i = list.findIndex((e) => e.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  checkpoint();
  [list[i], list[j]] = [list[j], list[i]];
  set({ elements: list }, { history: false });
}

export function duplicateElement(id) {
  const elm = state.elements.find((e) => e.id === id);
  if (!elm) return;
  const copy = {
    ...structuredClone({ ...elm, _img: undefined }),
    id: `${elm.id}_c${Math.floor(Math.random() * 1e4).toString(36)}`,
    x: Math.min(92, elm.x + 2),
    y: Math.min(96, elm.y + 2),
  };
  addElement(copy);
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
export function initArtboard() {
  artboard = $('#artboard');
  layer = $('#element-layer');
  label = $('#artboard-label');
  wrap = $('#canvas-wrap');
  if (!artboard) return;

  // Click on empty canvas clears the selection.
  wrap.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.el')) return;
    if (state.selectedElementId) set({ selectedElementId: null }, { history: false });
  });

  window.addEventListener('resize', () => { layoutArtboard(); renderElements(); });

  // Selecting anything else — or nothing, which is what Esc does — ends
  // inset view editing, so the next drag moves elements again.
  subscribe(['selectedElementId', 'elements'], () => {
    if (insetEditId && (state.selectedElementId !== insetEditId || !state.elements.some((e) => e.id === insetEditId))) {
      setInsetEditing(null);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (state.view !== 'studio') return;
    const target = event.target;
    if (target?.matches?.('input, textarea, select, [contenteditable]')) return;
    const id = state.selectedElementId;
    if (!id) return;
    const elm = state.elements.find((e) => e.id === id);
    if (!elm || elm.locked) return;

    if (event.key === 'Escape') { set({ selectedElementId: null }, { history: false }); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeElement(id); return; }

    const step = event.shiftKey ? 1 : 0.2;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    updateElement(id, { x: Number((elm.x + move[0]).toFixed(2)), y: Number((elm.y + move[1]).toFixed(2)) }, { history: false });
  });

  initPanMode();
  initLayoutView();
  initLiveGrid();
  layoutArtboard();
  renderElements();
}

/* ------------------------------------------------------------------ */
/* pan mode                                                            */
/* ------------------------------------------------------------------ */

/**
 * Turn pan mode on or off. In pan mode nothing on the page can be grabbed,
 * so a drag anywhere moves the map — the way out of a page crowded enough
 * that there is no bare map left to hold.
 */
export function setPanMode(on) {
  set({ panMode: Boolean(on) }, { history: false });
}

let panHeldBySpace = false;

function initPanMode() {
  const apply = () => {
    $('#studio')?.classList.toggle('is-panning', state.panMode);
    if (state.panMode && state.selectedElementId) set({ selectedElementId: null }, { history: false });
  };
  subscribe(['panMode'], apply);
  apply();

  const typing = (target) => target?.matches?.('input, textarea, select, [contenteditable]');

  // Hold Space to pan for a moment, the convention every design tool shares.
  window.addEventListener('keydown', (event) => {
    if (state.view !== 'studio' || typing(event.target)) return;
    if (event.key === 'Escape' && state.panMode) { panHeldBySpace = false; setPanMode(false); return; }
    if (event.code !== 'Space' || event.repeat) return;
    // A focused button would otherwise be "clicked" by the same key press.
    if (event.target?.matches?.('button, a, summary')) return;
    event.preventDefault();
    if (!state.panMode) { panHeldBySpace = true; setPanMode(true); }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code !== 'Space' || !panHeldBySpace) return;
    panHeldBySpace = false;
    setPanMode(false);
  });
  // Letting go of Space in another window must not leave the page frozen.
  window.addEventListener('blur', () => {
    if (!panHeldBySpace) return;
    panHeldBySpace = false;
    setPanMode(false);
  });
}

/**
 * Show a transient tip. It goes to the toast stack rather than a bubble on
 * the map, so it never sits over the scale bar or the page.
 */
export function hint(message, ms = 4200) {
  notify.info(message, { duration: ms });
}

export const artboardNode = () => artboard;
