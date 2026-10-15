/**
 * Element catalogue — the movable furniture that sits on the artboard.
 *
 * Every element type is defined exactly once, here, with three things:
 *   1. `defaults` + `style` — where it lands and how it looks
 *   2. `dom()`    — how it draws on screen, inside an `.el-inner` div
 *   3. `paint()`  — how it draws into the export canvas
 *
 * Both renderers read their content from the same helpers in derive.js and
 * use the same unit function `u()`, so what you drag on screen is what
 * comes out of the PDF. Keeping the pair side by side in one file is
 * deliberate: in the v2 prototype the DOM card and the canvas card were in
 * different places and drifted apart.
 */

import { FONTS, BASEMAPS } from '../core/constants.js';
import { uid, esc } from '../core/dom.js';
import { state } from '../core/store.js';
import { bboxOf } from '../core/geo.js';
import { getMap } from '../core/map.js';
import { contextFor } from '../data/inset-context.js';
import {
  rgba, roundRect, paintChrome, setFont, drawParagraph, drawLine, drawSwatch,
} from './paint.js';
import { legendRows, statsRows, metadataRows, creditsText, scaleBarFor, editRows } from './derive.js';
import { iconSvg } from '../layers/icons.js';
import { dashArray, isTransparent, swatchStroke } from '../layers/symbology.js';

/* ------------------------------------------------------------------ */
/* shared style presets                                                */
/* ------------------------------------------------------------------ */
const CARD = {
  bg: '#ffffff', bgOpacity: 0.94, border: '#e2e8f0', borderWidth: 0.9,
  radius: 8, padding: 9, shadow: true,
};
const PLAIN = {
  bg: '#ffffff', bgOpacity: 0, border: '#0f172a', borderWidth: 0,
  radius: 0, padding: 0, shadow: false,
};

const TEXT = { font: 'sans', size: 13, weight: 400, italic: false, color: '#0f172a', align: 'left', lineHeight: 1.32 };

/* ------------------------------------------------------------------ */
/* small helpers used by both renderers                                */
/* ------------------------------------------------------------------ */

/** Content box after border + padding, in the same units as `box`. */
export function contentBox(box, style, u) {
  const inset = u(style.padding ?? 0) + u(style.borderWidth ?? 0);
  return { x: box.x + inset, y: box.y + inset, w: box.w - inset * 2, h: box.h - inset * 2 };
}

/** Apply an element's chrome + typography to a DOM node. */
function chromeDom(node, style, u) {
  const bw = style.borderWidth ?? 0;
  Object.assign(node.style, {
    background: (style.bgOpacity ?? 0) > 0 ? rgba(style.bg, style.bgOpacity) : 'transparent',
    border: bw > 0 ? `${Math.max(0.5, u(bw))}px solid ${style.border}` : '0',
    borderRadius: `${u(style.radius ?? 0)}px`,
    padding: `${u(style.padding ?? 0)}px`,
    boxShadow: style.shadow ? `0 ${u(2.5)}px ${u(9)}px rgba(15,23,42,.16)` : 'none',
    color: style.color ?? '#0f172a',
    fontFamily: FONTS[style.font]?.stack ?? FONTS.sans.stack,
    fontSize: `${u(style.size ?? 13)}px`,
    fontWeight: String(style.weight ?? 400),
    fontStyle: style.italic ? 'italic' : 'normal',
    textAlign: style.align ?? 'left',
    lineHeight: String(style.lineHeight ?? 1.32),
  });
}

/**
 * Swatch markup for the on-screen legend — the twin of drawSwatch() in
 * paint.js. A row that carries an icon or a line pattern shows it, so the
 * legend key is the same mark the map draws.
 */
function swatchHtml(kind, color, px, mark = {}) {
  // Nothing is drawn, so the key shows an empty outline — the same way a
  // legend has always said "boundary only, no fill".
  if (isTransparent(color)) {
    const w = kind === 'line' ? px : px;
    const h = kind === 'line' ? Math.max(2, px * 0.5) : px * 0.84;
    const radius = kind === 'point' ? '50%' : `${px * 0.18}px`;
    return `<i style="display:block;width:${w}px;height:${h}px;flex:none;border:1px solid currentColor;border-radius:${radius};opacity:.55;background:transparent"></i>`;
  }

  if (kind === 'point' && mark.icon) {
    const svg = iconSvg(mark.icon, color, px);
    if (svg) return svg;
  }
  if (kind === 'line') {
    const h = Math.max(1.2, swatchStroke(px, mark.width));
    const pattern = dashArray(mark.dash);
    if (pattern) {
      // A repeating gradient reproduces the dasharray without an SVG, in the
      // same on/off proportions the map uses — including patterns with more
      // than one dash in them, like dash-dot.
      const stops = [];
      let at = 0;
      pattern.forEach((seg, i) => {
        const end = at + seg * h;
        stops.push(`${i % 2 ? 'transparent' : color} ${at}px ${end}px`);
        at = end;
      });
      return `<i style="display:block;width:${px}px;height:${h}px;flex:none;background:repeating-linear-gradient(90deg,${stops.join(',')})"></i>`;
    }
    return `<i style="display:block;width:${px}px;height:${h}px;border-radius:99px;background:${color};flex:none"></i>`;
  }
  if (kind === 'point') {
    return `<i style="display:block;width:${px * 0.78}px;height:${px * 0.78}px;border-radius:50%;background:${color};box-shadow:0 0 0 ${Math.max(0.6, px * 0.1)}px #fff;flex:none;margin:0 ${px * 0.11}px"></i>`;
  }
  return `<i style="display:block;width:${px}px;height:${px * 0.84}px;border-radius:${px * 0.18}px;background:${color};flex:none"></i>`;
}

/**
 * Collapse a run of `swatch: 'ramp'` rows into a single gradient entry.
 * A continuous index (NDVI, temperature) then prints as a colour bar with
 * end labels instead of a stack of near-identical squares.
 */
function groupLegendRows(rows) {
  const out = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (row.swatch === 'ramp' && last?.kind === 'ramp') {
      last.colors.push(row.color);
      last.labels.push(row.label);
    } else if (row.swatch === 'ramp') {
      out.push({ kind: 'ramp', colors: [row.color], labels: [row.label] });
    } else {
      out.push({ kind: 'item', ...row });
    }
  }
  return out;
}

const rampEnds = (labels) => {
  const named = labels.filter(Boolean);
  return [named[0] ?? '', named.length > 1 ? named[named.length - 1] : ''];
};

/** Rows of {label, value} as a two-column DOM block. */
function rowsHtml(rows, u, style, { valueAlign = 'right' } = {}) {
  const gap = u(style.gap ?? 2.6);
  return rows.map((r) => {
    const strong = r.emphasis ? `font-weight:700;` : '';
    const muted = r.muted ? `opacity:.6;` : '';
    return `<div style="display:flex;gap:${u(6)}px;justify-content:space-between;align-items:baseline;margin-bottom:${gap}px;${muted}">
      <span style="opacity:.72;white-space:nowrap">${esc(r.label)}</span>
      <span style="${strong}text-align:${valueAlign};min-width:0">${esc(r.value)}</span>
    </div>`;
  }).join('');
}

/** Paint a {label, value} row list into the canvas; returns the y cursor. */
function paintRows(c, rows, box, style, u, opts = {}) {
  const gap = u(style.gap ?? 2.6);
  const lh = u(style.size) * (style.lineHeight ?? 1.32);
  let y = box.y;
  for (const r of rows) {
    if (y + lh > box.y + box.h) break;
    const alpha = r.muted ? 0.6 : 1;
    c.globalAlpha = alpha;
    setFont(c, { ...style, weight: 400 }, u);
    const labelW = c.measureText(r.label).width;
    drawLine(c, r.label, box.x, y, box.w * 0.62, { ...style, weight: 400, color: rgba(style.color, 0.74), u });
    const valueStyle = { ...style, weight: r.emphasis ? 700 : (opts.valueWeight ?? 600), u, color: style.color };
    setFont(c, valueStyle, u);
    const vw = Math.max(0, box.w - labelW - u(6));
    drawLine(c, r.value, box.x + box.w - vw, y, vw, { ...valueStyle, align: 'right' });
    c.globalAlpha = 1;
    y += lh + gap;
  }
  return y;
}

/** Section heading shared by legend / stats / metadata. */
function paintHeading(c, text, box, style, u) {
  if (!text) return box.y;
  const size = (style.size ?? 12) * 0.86;
  setFont(c, { ...style, size, weight: 800 }, u);
  c.fillStyle = rgba(style.color, 0.62);
  c.textBaseline = 'top';
  c.fillText(String(text).toUpperCase(), box.x, box.y);
  return box.y + u(size) * 1.9;
}

function headingHtml(text, style, u) {
  if (!text) return '';
  const size = (style.size ?? 12) * 0.86;
  return `<div style="font-size:${u(size)}px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;opacity:.62;margin-bottom:${u(size) * 0.75}px">${esc(text)}</div>`;
}

/* ------------------------------------------------------------------ */
/* north arrow glyphs — one description, two renderers                 */
/* ------------------------------------------------------------------ */
const NORTH_SHAPES = {
  arrow: {
    ring: false,
    polys: [{ pts: [[50, 4], [74, 86], [50, 66], [26, 86]], tone: 'solid' }],
  },
  needle: {
    ring: false,
    polys: [
      { pts: [[50, 4], [66, 84], [50, 62]], tone: 'solid' },
      { pts: [[50, 4], [34, 84], [50, 62]], tone: 'light' },
    ],
  },
  compass: {
    ring: true,
    polys: [
      { pts: [[8, 50], [50, 42], [92, 50], [50, 58]], tone: 'light' },
      { pts: [[50, 6], [58, 50], [50, 94], [42, 50]], tone: 'solid' },
    ],
  },
};

const toneFill = (tone, color) => (tone === 'light' ? rgba(color, 0.24) : color);

function northSvg(variant, color, rotation) {
  const shape = NORTH_SHAPES[variant] ?? NORTH_SHAPES.arrow;
  const ring = shape.ring
    ? `<circle cx="50" cy="50" r="47" fill="none" stroke="${color}" stroke-width="3"/>`
    : '';
  const polys = shape.polys.map((p) =>
    `<polygon points="${p.pts.map(([x, y]) => `${x},${y}`).join(' ')}" fill="${toneFill(p.tone, color)}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`).join('');
  return `<svg viewBox="0 0 100 100" style="width:100%;height:100%;display:block;transform:rotate(${rotation}deg)">${ring}${polys}</svg>`;
}

function paintNorthGlyph(c, variant, color, cx, cy, side, rotation) {
  const shape = NORTH_SHAPES[variant] ?? NORTH_SHAPES.arrow;
  c.save();
  c.translate(cx, cy);
  c.rotate((rotation * Math.PI) / 180);
  c.scale(side / 100, side / 100);
  c.translate(-50, -50);
  c.lineJoin = 'round';
  c.strokeStyle = color;
  c.lineWidth = 1.6;
  if (shape.ring) {
    c.beginPath();
    c.arc(50, 50, 47, 0, Math.PI * 2);
    c.lineWidth = 3;
    c.stroke();
    c.lineWidth = 1.6;
  }
  for (const poly of shape.polys) {
    c.beginPath();
    poly.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fillStyle = toneFill(poly.tone, color);
    c.fill();
    c.stroke();
  }
  c.restore();
}

/* ------------------------------------------------------------------ */
/* shapes — one geometry description, two renderers                    */
/* ------------------------------------------------------------------ */
export const SHAPE_VARIANTS = [
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'ellipse',   label: 'Ellipse' },
  { id: 'triangle',  label: 'Triangle' },
  { id: 'diamond',   label: 'Diamond' },
  { id: 'star',      label: 'Star' },
  { id: 'line',      label: 'Line' },
  { id: 'arrow',     label: 'Arrow' },
];

/** Points on a 0–100 grid, or null for shapes drawn with their own path. */
function shapePoints(variant) {
  switch (variant) {
    case 'triangle': return [[50, 2], [98, 98], [2, 98]];
    case 'diamond':  return [[50, 2], [98, 50], [50, 98], [2, 50]];
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 21 : 49;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        pts.push([50 + Math.cos(a) * r * 2, 50 + Math.sin(a) * r * 2]);
      }
      return pts;
    }
    case 'arrow': return [[2, 36], [64, 36], [64, 14], [98, 50], [64, 86], [64, 64], [2, 64]];
    case 'line':  return [[2, 50], [98, 50]];
    default: return null;
  }
}

const DASH_ARRAY = { solid: '', dashed: '6 4', dotted: '1.5 4' };

function shapeSvg(s, u) {
  const stroke = Math.max(0, u(s.strokeWidth ?? 0));
  const fill = (s.fillOpacity ?? 0) > 0 ? rgba(s.fill, s.fillOpacity) : 'none';
  const dash = DASH_ARRAY[s.dash] ?? '';
  const common = `fill="${fill}" stroke="${s.stroke}" stroke-width="${stroke}" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}`;

  let body;
  if (s.variant === 'ellipse') {
    body = `<ellipse cx="50" cy="50" rx="48" ry="48" ${common}/>`;
  } else if (s.variant === 'rectangle' || !s.variant) {
    const r = Math.max(0, Math.min(40, s.radius ?? 0));
    body = `<rect x="2" y="2" width="96" height="96" rx="${r}" ${common}/>`;
  } else if (s.variant === 'line') {
    body = `<line x1="2" y1="50" x2="98" y2="50" fill="none" stroke="${s.stroke}" stroke-width="${stroke}" vector-effect="non-scaling-stroke" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  } else {
    const pts = shapePoints(s.variant) ?? [];
    body = `<polygon points="${pts.map(([x, y]) => `${x},${y}`).join(' ')}" ${common}/>`;
  }

  const spin = s.rotation ? ` transform="rotate(${s.rotation} 50 50)"` : '';
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible"><g${spin}>${body}</g></svg>`;
}

function paintShape(c, s, box, u) {
  const stroke = Math.max(0, u(s.strokeWidth ?? 0));
  const hasFill = (s.fillOpacity ?? 0) > 0;

  c.save();
  c.translate(box.x + box.w / 2, box.y + box.h / 2);
  if (s.rotation) c.rotate((s.rotation * Math.PI) / 180);
  c.translate(-box.w / 2, -box.h / 2);

  const sx = box.w / 100;
  const sy = box.h / 100;
  const at = (x, y) => [x * sx, y * sy];

  c.beginPath();
  if (s.variant === 'ellipse') {
    c.ellipse(box.w / 2, box.h / 2, (box.w / 2) * 0.96, (box.h / 2) * 0.96, 0, 0, Math.PI * 2);
  } else if (s.variant === 'rectangle' || !s.variant) {
    const r = Math.min((s.radius ?? 0) * sx, box.w / 2, box.h / 2);
    roundRect(c, 2 * sx, 2 * sy, 96 * sx, 96 * sy, r);
  } else {
    const pts = shapePoints(s.variant) ?? [];
    pts.forEach(([x, y], i) => {
      const [px, py] = at(x, y);
      if (i) c.lineTo(px, py); else c.moveTo(px, py);
    });
    if (s.variant !== 'line') c.closePath();
  }

  if (hasFill && s.variant !== 'line') {
    c.fillStyle = rgba(s.fill, s.fillOpacity);
    c.fill();
  }
  if (stroke > 0) {
    c.lineWidth = stroke;
    c.strokeStyle = s.stroke;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    if (s.dash === 'dashed') c.setLineDash([stroke * 3, stroke * 2]);
    else if (s.dash === 'dotted') c.setLineDash([stroke * 0.8, stroke * 2.2]);
    c.stroke();
  }
  c.restore();
}

/* ------------------------------------------------------------------ */
/* locator inset — project a study area into a small box               */
/* ------------------------------------------------------------------ */
/**
 * A lng/lat → box-pixel function fitted to `reference`, aspect preserved.
 *
 * Split out from the ring extraction below so that several outlines — a study
 * area and the region containing it — can share **one** projection. Projecting
 * each to its own bounds would centre both in the box and draw the study area
 * filling a country it is a fiftieth the size of.
 */
/*
 * Web Mercator, on the unit square: x and y run 0 → 1 across the whole
 * world. The inset draws basemap tiles under its outlines, and tiles are in
 * this projection, so the outlines have to be too or they slide off the
 * coastline they are drawn over.
 */
const mercX = (lng) => (lng + 180) / 360;
const mercY = (lat) => {
  const r = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(r)) / Math.PI) / 2;
};

/**
 * @param {object} reference  GeoJSON the view is fitted to
 * @param {{x,y,w,h}} box
 * @param {{zoom?: number, pan?: number[]}} [view]  the inset's own view:
 *        zoom in powers of two over the fitted view, and pan as a fraction of
 *        the box, so the same view gives the same picture on screen and on a
 *        300 dpi print.
 * @returns the projector, carrying `k` (pixels per world) and its origin
 */
function ringProjector(reference, box, view = {}) {
  const b = bboxOf(reference);
  if (!b) return null;
  const [w, s, e, n] = b;
  const x0 = mercX(w); const x1 = mercX(e);
  const y0 = mercY(n); const y1 = mercY(s);
  const spanX = Math.max(x1 - x0, 1e-12);
  const spanY = Math.max(y1 - y0, 1e-12);
  const k = Math.min(box.w / spanX, box.h / spanY) * 2 ** (Number(view.zoom) || 0);
  const pan = view.pan ?? [0, 0];
  const ox = box.x + box.w / 2 + (pan[0] || 0) * box.w - ((x0 + x1) / 2) * k;
  const oy = box.y + box.h / 2 + (pan[1] || 0) * box.h - ((y0 + y1) / 2) * k;
  const project = ([lng, lat]) => [ox + mercX(lng) * k, oy + mercY(lat) * k];
  return Object.assign(project, { k, ox, oy });
}

/** Tile templates for an inset basemap: its rasters, or a vector style's stand-in. */
function insetTileSources(key) {
  if (!key || key === 'none') return null;
  const spec = BASEMAPS[key];
  if (!spec) return null;
  if (spec.rasters) return spec.rasters.map((r) => ({ tiles: r.tiles, maxzoom: r.maxzoom ?? 19 }));
  return spec.thumb ? [{ tiles: spec.thumb, maxzoom: 19 }] : null;
}

/**
 * The basemap tiles covering `clip`, placed in the same pixel space as the
 * outlines. The tile zoom follows the drawing's real resolution, so a print
 * at 300 dpi fetches sharper tiles than the screen does, within a budget.
 */
function insetTiles(key, project, clip) {
  const sources = insetTileSources(key);
  if (!sources) return null;
  const { k, ox, oy } = project;
  const maxZ = Math.min(...sources.map((src) => src.maxzoom));
  let z = Math.max(0, Math.min(maxZ, Math.round(Math.log2(Math.max(k, 1) / 256))));
  const count = (zz) => {
    const size = k / 2 ** zz;
    return (Math.ceil(clip.w / size) + 1) * (Math.ceil(clip.h / size) + 1);
  };
  while (z > 0 && count(z) > 80) z -= 1;

  const n = 2 ** z;
  const size = k / n;
  const tx0 = Math.floor((clip.x - ox) / size);
  const tx1 = Math.floor((clip.x + clip.w - ox) / size);
  const ty0 = Math.max(0, Math.floor((clip.y - oy) / size));
  const ty1 = Math.min(n - 1, Math.floor((clip.y + clip.h - oy) / size));
  const tiles = [];
  for (const src of sources) {
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const wx = ((tx % n) + n) % n;
        const template = src.tiles[(wx + ty) % src.tiles.length];
        tiles.push({
          url: template.replace('{z}', z).replace('{x}', wx).replace('{y}', ty),
          x: ox + tx * size, y: oy + ty * size, size,
        });
      }
    }
  }
  return tiles;
}

/** Tile images shared by the screen and the export, loaded CORS-clean. */
const TILE_CACHE = new Map();
function tileImage(url) {
  let img = TILE_CACHE.get(url);
  if (!img) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = url;
    TILE_CACHE.set(url, img);
    if (TILE_CACHE.size > 600) TILE_CACHE.delete(TILE_CACHE.keys().next().value);
  }
  return img;
}
const tileReady = (img) => img.complete && img.naturalWidth > 0;

/* ------------------------------------------------------------------ */
/* grid (graticule) — latitude/longitude lines and edge labels          */
/* ------------------------------------------------------------------ */
/*
 * Lines are worked out against the live map, in the element's own unit
 * square (0–1 across, 0–1 down), so the screen and a 300 dpi export draw the
 * same thing at their own resolution. Under Web Mercator with no tilt a
 * meridian or parallel is a straight line on screen even when the map is
 * rotated, so two projected points per line are enough.
 */
const GRID_STEPS = [
  1 / 3600, 2 / 3600, 5 / 3600, 10 / 3600, 15 / 3600, 30 / 3600,
  1 / 60, 2 / 60, 5 / 60, 10 / 60, 15 / 60, 30 / 60,
  1, 2, 5, 10, 15, 20, 30, 45,
];

/** A tidy interval for the span: about four to eight lines on the long side. */
export function gridStep(span) {
  return GRID_STEPS.find((s) => span / s <= 8) ?? 45;
}

/** 7.5 → 7°30′E, at no more precision than the interval needs. */
export function gridLabel(value, axis, step, format = 'dms') {
  const hemi = axis === 'lng' ? (value >= 0 ? 'E' : 'W') : (value >= 0 ? 'N' : 'S');
  const abs = Math.abs(value);
  if (format === 'dd') {
    const dp = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4;
    return `${abs.toFixed(dp)}°${hemi}`;
  }
  // Rounded to the nearest second first, so 7.9999999 prints as 8°, not 7°59′60″.
  const total = Math.round(abs * 3600);
  const d = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (step >= 1 && !m && !sec) return `${d}°${hemi}`;
  if (step >= 1 / 60 && !sec) return `${d}°${String(m).padStart(2, '0')}′${hemi}`;
  return `${d}°${String(m).padStart(2, '0')}′${String(sec).padStart(2, '0')}″${hemi}`;
}

/** Clip the segment p→q to the unit square (Liang–Barsky). */
function clipUnit(p, q) {
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  for (const [pk, qk] of [[-dx, p[0]], [dx, 1 - p[0]], [-dy, p[1]], [dy, 1 - p[1]]]) {
    if (pk === 0) { if (qk < 0) return null; continue; }
    const t = qk / pk;
    if (pk < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [[p[0] + t0 * dx, p[1] + t0 * dy], [p[0] + t1 * dx, p[1] + t1 * dy]];
}

const edgeOf = ([x, y]) => {
  const e = 1e-3;
  if (y <= e) return 'top';
  if (y >= 1 - e) return 'bottom';
  if (x <= e) return 'left';
  if (x >= 1 - e) return 'right';
  return null;
};

/**
 * Where the box that element percentages are measured in sits on screen, in
 * map-container pixels. That is the element layer — the artboard *inside*
 * its dashed border — not the artboard itself; measuring the outer box put
 * every grid line a little off, more so the further it was from the corner.
 */
function pageOnScreen() {
  if (typeof document === 'undefined') return null;
  const layer = document.getElementById('element-layer');
  const map = getMap();
  const host = map?.getContainer?.();
  if (!layer || !host) return null;
  const r = layer.getBoundingClientRect();
  const o = host.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
}

/**
 * The grid for an element: lines as unit-square segments, and labels where
 * they meet an edge the user wants labelled. Null without a map.
 */
function gridPlan(elm) {
  const map = getMap();
  const page = pageOnScreen();
  if (!map || !page) return null;
  const s = elm.style ?? {};
  const ex = page.x + (elm.x / 100) * page.w;
  const ey = page.y + (elm.y / 100) * page.h;
  const ew = (elm.w / 100) * page.w;
  const eh = (elm.h / 100) * page.h;
  if (ew < 4 || eh < 4) return null;

  const corners = [[ex, ey], [ex + ew, ey], [ex, ey + eh], [ex + ew, ey + eh]].map((p) => map.unproject(p));
  const lngs = corners.map((c) => c.lng);
  const lats = corners.map((c) => Math.max(-85, Math.min(85, c.lat)));
  const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const auto = !s.interval || s.interval === 'auto';
  const step = auto ? gridStep(Math.max(maxLng - minLng, maxLat - minLat)) : Number(s.interval);
  if (!(step > 0)) return null;

  const toUnit = (lng, lat) => {
    const p = map.project([lng, lat]);
    return [(p.x - ex) / ew, (p.y - ey) / eh];
  };
  const wanted = { top: s.labelTop !== false, bottom: s.labelBottom !== false, left: s.labelLeft !== false, right: s.labelRight !== false };
  const lines = [];
  const labels = [];
  const add = (a, b, value, axis) => {
    const seg = clipUnit(a, b);
    if (!seg) return;
    lines.push({ a: seg[0], b: seg[1], value, axis });
    for (const end of seg) {
      const edge = edgeOf(end);
      // Labels hard against a corner collide with the other axis's labels.
      const along = edge === 'top' || edge === 'bottom' ? end[0] : end[1];
      if (edge && wanted[edge] && along > 0.035 && along < 0.965) {
        labels.push({ edge, u: end[0], v: end[1], text: gridLabel(value, axis, step, s.format) });
      }
    }
  };
  const round = (v) => Math.round(v / step) * step;
  const padLat = (maxLat - minLat) * 0.5 + step;
  const padLng = (maxLng - minLng) * 0.5 + step;
  let n = 0;
  for (let v = Math.ceil(minLng / step) * step; v <= maxLng + 1e-9 && n < 200; v += step, n += 1) {
    const lng = round(v);
    add(toUnit(lng, Math.max(-85, minLat - padLat)), toUnit(lng, Math.min(85, maxLat + padLat)), lng, 'lng');
  }
  n = 0;
  for (let v = Math.ceil(minLat / step) * step; v <= maxLat + 1e-9 && n < 200; v += step, n += 1) {
    const lat = round(v);
    add(toUnit(minLng - padLng, lat), toUnit(maxLng + padLng, lat), lat, 'lat');
  }
  return { lines, labels, step };
}

/**
 * Where a label sits, for an SVG or a canvas, in the box's own pixels.
 *
 * Outside (the default) is the cartographic convention: longitudes above and
 * below the frame, latitudes beside it turned to read upwards — turned so
 * that a label like 9°30′N needs only a text-height of margin, not its whole
 * width. Inside keeps everything within the frame, for a full-bleed page
 * with no margin to put labels in.
 *
 * `rotate` is in degrees about (x, y).
 */
function gridLabelPlacement(lb, W, H, fs, outside = true) {
  const pad = fs * 0.4;
  if (outside) {
    switch (lb.edge) {
      case 'top': return { x: lb.u * W, y: -pad, anchor: 'middle', baseline: 'auto', rotate: 0 };
      case 'bottom': return { x: lb.u * W, y: H + pad, anchor: 'middle', baseline: 'hanging', rotate: 0 };
      // Turned -90°: "above the baseline" now points left, away from the frame.
      case 'left': return { x: -pad, y: lb.v * H, anchor: 'middle', baseline: 'auto', rotate: -90 };
      // Same turn; hanging below the baseline points right, away from the frame.
      default: return { x: W + pad, y: lb.v * H, anchor: 'middle', baseline: 'hanging', rotate: -90 };
    }
  }
  const clampX = (x) => Math.max(fs * 2.2, Math.min(W - fs * 2.2, x));
  const clampY = (y) => Math.max(fs, Math.min(H - fs, y));
  switch (lb.edge) {
    case 'top': return { x: clampX(lb.u * W), y: pad, anchor: 'middle', baseline: 'hanging', rotate: 0 };
    case 'bottom': return { x: clampX(lb.u * W), y: H - pad, anchor: 'middle', baseline: 'auto', rotate: 0 };
    case 'left': return { x: pad, y: clampY(lb.v * H), anchor: 'start', baseline: 'middle', rotate: 0 };
    default: return { x: W - pad, y: clampY(lb.v * H), anchor: 'end', baseline: 'middle', rotate: 0 };
  }
}

/** The inset's outlines on a canvas: surrounding region, study area, view box. */
function paintInsetShapes(c, s, plan, w) {
  const trace = (rings) => {
    c.beginPath();
    for (const ring of rings) {
      ring.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
    }
  };

  c.save();
  c.lineJoin = 'round';

  // The surrounding region first, so the study area reads as sitting
  // inside it rather than beside it. Over a basemap it is a tint, not a
  // solid fill, or it would hide the map it is meant to sit on.
  if (plan.context) {
    trace(plan.context);
    c.fillStyle = rgba(s.contextFill, plan.tiles ? (s.contextOpacity ?? 0.3) : 1);
    c.fill('evenodd');
    c.strokeStyle = s.contextStroke;
    c.lineWidth = w * 0.75;
    c.stroke();
  }

  trace(plan.area);
  c.fillStyle = rgba(s.fill, s.fillOpacity);
  c.fill('evenodd');
  c.strokeStyle = s.stroke;
  c.lineWidth = w;
  c.stroke();

  if (plan.extent) {
    c.strokeStyle = s.extentStroke;
    c.lineWidth = w;
    c.strokeRect(plan.extent.x, plan.extent.y, plan.extent.w, plan.extent.h);
  }
  c.restore();
}

/**
 * Fetch every basemap tile the export's insets will draw, before painting
 * starts — a canvas cannot wait for an image mid-draw. A tile that fails or
 * takes longer than the timeout is left out instead of stopping the export.
 *
 * @param {{elm: object, box: {x,y,w,h}}[]} jobs  inset elements with their
 *        content boxes in export pixels
 */
export function preloadInsetTiles(jobs, timeoutMs = 12000) {
  const urls = new Set();
  for (const { elm, box } of jobs) {
    for (const t of insetPlan(elm, box)?.tiles ?? []) urls.add(t.url);
  }
  const loads = [...urls].map((url) => {
    const img = tileImage(url);
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  return Promise.race([Promise.all(loads), timeout]);
}

/** The inset's view, after zooming by `steps` (powers of two) about a point. */
export function zoomInsetView(style, steps, about = [0, 0]) {
  const zoom = Math.max(-3, Math.min(8, (Number(style.viewZoom) || 0) + steps));
  const f = 2 ** (zoom - (Number(style.viewZoom) || 0));
  const [px, py] = style.viewPan ?? [0, 0];
  // Keep the point under `about` (a fraction of the box from its centre) still.
  return { viewZoom: zoom, viewPan: [(px - about[0]) * f + about[0], (py - about[1]) * f + about[1]] };
}

/** Every polygon ring of a GeoJSON, projected and thinned for drawing. */
function ringsOf(geojson, project, stride = 1) {
  const rings = [];
  for (const f of geojson?.features ?? [geojson]) {
    const g = f?.geometry ?? f;
    if (!g) continue;
    const polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
    for (const poly of polys) {
      for (const ring of poly) {
        // An administrative outline can run to thousands of vertices and the
        // inset is a few centimetres across; past a few hundred points nothing
        // is added but time, on every repaint.
        const step = Math.max(stride, Math.ceil(ring.length / 400));
        const out = [];
        for (let i = 0; i < ring.length; i += step) out.push(project(ring[i]));
        if (out.length > 2) rings.push(out);
      }
    }
  }
  return rings.length ? rings : null;
}

/**
 * Everything the locator inset needs to draw, computed once for both
 * renderers.
 *
 * Both of them used to project the geometry themselves, which is how the
 * on-screen inset and the printed one came to disagree. One function, two
 * callers, no second opinion — the same rule the rest of this module follows.
 *
 * Projection is fitted to *the widest thing being drawn*: with a context
 * outline that is the context, so the study area lands in its true position
 * inside it, which is the entire point of a locator. Without one it is the
 * study area, exactly as before.
 *
 * @param {object} elm
 * @param {{x,y,w,h}} [box]  canvas pixels; omitted for the screen, which
 *        works in a viewBox of the element's own proportions instead.
 */
function insetPlan(elm, box) {
  const sa = state.studyArea;
  if (!sa?.geojson) return null;

  const s = elm.style ?? {};
  const mode = s.context ?? 'auto';
  const ctx = mode === 'none' ? null : contextFor(sa, mode);

  // On screen the viewBox is the element's aspect, scaled to a comfortable
  // number of user units; on canvas it is the box we were handed.
  const aspect = box ? box.w / box.h : Math.max(0.05, (elm.w || 1) / (elm.h || 1));
  const W = box ? box.w : (aspect >= 1 ? 100 : 100 * aspect);
  const H = box ? box.h : (aspect >= 1 ? 100 / aspect : 100);
  const pad = Math.min(W, H) * 0.04;
  const frame = box
    ? { x: box.x + pad, y: box.y + pad, w: box.w - pad * 2, h: box.h - pad * 2 }
    : { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 };

  // One projection for every ring, taken from whichever outline is widest, so
  // the study area sits where it really sits inside the context.
  const reference = ctx?.geojson ?? sa.geojson;
  const project = ringProjector(reference, frame, { zoom: s.viewZoom, pan: s.viewPan });
  if (!project) return null;
  const tiles = insetTiles(s.basemap, project, { x: box?.x ?? 0, y: box?.y ?? 0, w: W, h: H });

  const area = ringsOf(sa.geojson, project);
  if (!area?.length) return null;

  let extent = null;
  if (s.extent) {
    const b = viewBboxOf();
    if (b) {
      const [x0, y1] = project([b[0], b[3]]);
      const [x1, y0] = project([b[2], b[1]]);
      // A view zoomed well inside the study area collapses to a dot, which
      // reads as a stray mark rather than as "you are here".
      if (Math.abs(x1 - x0) >= 1.5 && Math.abs(y0 - y1) >= 1.5) {
        extent = { x: x0, y: y1, w: x1 - x0, h: y0 - y1 };
      }
    }
  }

  return {
    W, H,
    area,
    tiles,
    context: ctx ? ringsOf(ctx.geojson, project) : null,
    extent,
    stroke: box ? 1 : Math.max(0.6, Math.min(W, H) * 0.012),
  };
}

/**
 * The pixel box of an element's inner node, or null before it has one.
 *
 * Null on the very first paint of a fresh artboard, which is why insetPlan
 * still has a fallback: the element renders once at an estimated aspect and
 * again, correctly, as soon as it has been laid out.
 */
function boxOfNode(node) {
  if (!node) return null;
  // getBoundingClientRect, not clientWidth: the latter is rounded to whole
  // pixels, and a 100 × 66.4 box reported as 100 × 66 is an aspect ratio 1.5%
  // out — which the SVG then applies to the outline as a 1.5% stretch.
  const { width: w, height: h } = node.getBoundingClientRect();
  return w > 2 && h > 2 ? { x: 0, y: 0, w, h } : null;
}

/** The bounding box the main map is currently showing, as [w, s, e, n]. */
function viewBboxOf() {
  try {
    const b = getMap()?.getBounds();
    if (!b) return null;
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* the catalogue                                                       */
/* ------------------------------------------------------------------ */

/**
 * @typedef {object} ElementDef
 * @property {string} label    shown in the Elements panel and the selection tag
 * @property {string} icon
 * @property {string} hint
 * @property {string[]} inspect  which inspector control groups to show
 * @property {object} defaults   x, y, w, h (percent of artboard) and text
 * @property {object} style
 * @property {(inner: HTMLElement, elm: object, ctx: object) => void} dom
 * @property {(c: CanvasRenderingContext2D, elm: object, box: object, ctx: object) => void} paint
 */

/** @type {Record<string, ElementDef>} */
export const ELEMENT_TYPES = {
  /* ---------------------------------------------------------------- */
  title: {
    label: 'Title', icon: 'T', hint: 'The headline of the map',
    inspect: ['text', 'type', 'chrome'],
    defaults: { x: 6, y: 5, w: 62, h: 8, text: 'Map title' },
    style: { ...TEXT, ...PLAIN, font: 'display', size: 34, weight: 600, lineHeight: 1.12 },
    dom(inner, elm) {
      inner.style.whiteSpace = 'pre-wrap';
      inner.textContent = elm.text ?? '';
    },
    paint(c, elm, box, ctx) {
      drawParagraph(c, elm.text ?? '', box, { ...elm.style, u: ctx.u });
    },
  },

  subtitle: {
    label: 'Subtitle', icon: 't', hint: 'A line of context under the title',
    inspect: ['text', 'type', 'chrome'],
    defaults: { x: 6, y: 13.4, w: 62, h: 5, text: 'Study area · prepared 2026' },
    style: { ...TEXT, ...PLAIN, size: 15, weight: 400, color: '#475569', lineHeight: 1.25 },
    dom(inner, elm) {
      inner.style.whiteSpace = 'pre-wrap';
      inner.textContent = elm.text ?? '';
    },
    paint(c, elm, box, ctx) {
      drawParagraph(c, elm.text ?? '', box, { ...elm.style, u: ctx.u });
    },
  },

  text: {
    label: 'Text box', icon: '¶', hint: 'Free text — notes, a caption, a disclaimer',
    inspect: ['text', 'type', 'chrome'],
    defaults: { x: 6, y: 62, w: 34, h: 12, text: 'Add your note here.' },
    style: { ...TEXT, ...PLAIN, size: 12 },
    dom(inner, elm) {
      inner.style.whiteSpace = 'pre-wrap';
      inner.textContent = elm.text ?? '';
    },
    paint(c, elm, box, ctx) {
      drawParagraph(c, elm.text ?? '', box, { ...elm.style, u: ctx.u });
    },
  },

  /* ---------------------------------------------------------------- */
  legend: {
    label: 'Legend', icon: '▤', hint: 'Updates itself from the visible layers',
    inspect: ['heading', 'type', 'chrome', 'legend'],
    defaults: { x: 6, y: 72, w: 30, h: 22, text: 'Legend' },
    style: { ...TEXT, ...CARD, size: 11, gap: 2.6, swatch: 13 },
    dom(inner, elm, ctx) {
      const { u } = ctx;
      const groups = groupLegendRows(legendRows());
      const sw = u(elm.style.swatch ?? 13);
      const gap = u(elm.style.gap ?? 2.6);

      const body = groups.length
        ? groups.map((g) => {
            if (g.kind === 'ramp') {
              const [from, to] = rampEnds(g.labels);
              return `<div style="margin-bottom:${gap * 1.6}px">
                <div style="height:${sw * 0.86}px;border-radius:${sw * 0.16}px;background:linear-gradient(90deg,${g.colors.join(',')})"></div>
                <div style="display:flex;justify-content:space-between;gap:${u(4)}px;margin-top:${u(1.4)}px;opacity:.72">
                  <span>${esc(from)}</span><span>${esc(to)}</span>
                </div>
              </div>`;
            }
            return `<div style="display:flex;align-items:center;gap:${u(5)}px;margin-bottom:${gap}px">
              ${swatchHtml(g.swatch, g.color, sw, g)}
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.label)}</span>
            </div>`;
          }).join('')
        : `<div style="opacity:.55">Turn on a layer and it appears here.</div>`;

      inner.innerHTML = headingHtml(elm.text, elm.style, u) + body;
    },
    paint(c, elm, box, ctx) {
      const { u } = ctx;
      const s = elm.style;
      let y = paintHeading(c, elm.text, box, s, u);
      const groups = groupLegendRows(legendRows());
      const sw = u(s.swatch ?? 13);
      const lh = u(s.size) * (s.lineHeight ?? 1.32);
      const gap = u(s.gap ?? 2.6);
      const bottom = box.y + box.h;

      if (!groups.length) {
        drawLine(c, 'Turn on a layer and it appears here.', box.x, y, box.w, { ...s, u, color: rgba(s.color, 0.55) });
        return;
      }

      for (const g of groups) {
        if (g.kind === 'ramp') {
          const barH = sw * 0.86;
          if (y + barH + lh > bottom + lh * 0.4) break;
          const grad = c.createLinearGradient(box.x, 0, box.x + box.w, 0);
          g.colors.forEach((color, i) => grad.addColorStop(g.colors.length === 1 ? 0 : i / (g.colors.length - 1), color));
          roundRect(c, box.x, y, box.w, barH, barH * 0.16);
          c.fillStyle = grad;
          c.fill();

          const [from, to] = rampEnds(g.labels);
          const labelY = y + barH + u(1.4);
          drawLine(c, from, box.x, labelY, box.w / 2, { ...s, u, color: rgba(s.color, 0.72) });
          drawLine(c, to, box.x + box.w / 2, labelY, box.w / 2, { ...s, u, align: 'right', color: rgba(s.color, 0.72) });
          y = labelY + lh + gap * 1.6;
          continue;
        }

        const step = Math.max(lh, sw) + gap;
        if (y + step > bottom + step * 0.4) break;
        // `inkColor` lets a hollow swatch borrow the legend's own text colour,
        // which is what `currentColor` does for the on-screen twin.
        drawSwatch(c, g.swatch, box.x, y + (lh - sw * 0.84) / 2 - u(0.5), sw, g.color, { ...g, inkColor: s.color });
        drawLine(c, g.label, box.x + sw + u(5), y, box.w - sw - u(5), { ...s, u });
        y += step;
      }
    },
  },

  stats: {
    label: 'Key figures', icon: '◫', hint: 'Study area, feature counts, analysis results',
    inspect: ['heading', 'rows', 'type', 'chrome'],
    rows: () => statsRows(),
    defaults: { x: 68, y: 72, w: 26, h: 20, text: 'Key figures' },
    style: { ...TEXT, ...CARD, size: 11, gap: 2.4 },
    dom(inner, elm, ctx) {
      const { u } = ctx;
      inner.innerHTML = headingHtml(elm.text, elm.style, u) + rowsHtml(editRows(statsRows(), elm.rowEdits), u, elm.style);
    },
    paint(c, elm, box, ctx) {
      const s = elm.style;
      const y = paintHeading(c, elm.text, box, s, ctx.u);
      paintRows(c, editRows(statsRows(), elm.rowEdits), { ...box, y, h: box.h - (y - box.y) }, s, ctx.u);
    },
  },

  metadata: {
    label: 'Map information', icon: 'ℹ', hint: 'Author, date, projection, sources',
    inspect: ['heading', 'rows', 'type', 'chrome'],
    rows: () => metadataRows(),
    defaults: { x: 68, y: 46, w: 26, h: 24, text: 'Map information' },
    style: { ...TEXT, ...CARD, size: 9, gap: 2.2, lineHeight: 1.28 },
    dom(inner, elm, ctx) {
      const { u } = ctx;
      inner.innerHTML = headingHtml(elm.text, elm.style, u) + rowsHtml(editRows(metadataRows(), elm.rowEdits), u, elm.style);
    },
    paint(c, elm, box, ctx) {
      const s = elm.style;
      const y = paintHeading(c, elm.text, box, s, ctx.u);
      paintRows(c, editRows(metadataRows(), elm.rowEdits), { ...box, y, h: box.h - (y - box.y) }, s, ctx.u, { valueWeight: 500 });
    },
  },

  credits: {
    label: 'Credits', icon: '©', hint: 'Data attribution — required by OpenStreetMap',
    inspect: ['creditsText', 'type', 'chrome'],
    defaults: { x: 6, y: 95.5, w: 60, h: 3.4 },
    style: { ...TEXT, ...PLAIN, size: 7.5, color: '#64748b', lineHeight: 1.35 },
    // `elm.customText`, when set, replaces the automatic attribution.
    dom(inner, elm) {
      inner.textContent = elm.customText || creditsText();
    },
    paint(c, elm, box, ctx) {
      drawParagraph(c, elm.customText || creditsText(), box, { ...elm.style, u: ctx.u, maxLines: 3 });
    },
  },

  /* ---------------------------------------------------------------- */
  north: {
    label: 'North arrow', icon: '⇧', hint: 'Rotates with the map',
    inspect: ['north', 'chrome'],
    defaults: { x: 88, y: 5, w: 7, h: 9 },
    style: { ...TEXT, ...PLAIN, size: 10, weight: 800, color: '#0f172a', align: 'center', variant: 'arrow', showLabel: true },
    dom(inner, elm, ctx) {
      const { u } = ctx;
      const s = elm.style;
      const labelH = s.showLabel === false ? 0 : u(s.size) * 1.35;
      inner.innerHTML =
        `<div style="height:calc(100% - ${labelH}px);display:grid;place-items:center">
           <div style="height:100%;aspect-ratio:1">${northSvg(s.variant, s.color, -(state.mapView.bearing ?? 0))}</div>
         </div>` +
        (labelH ? `<div style="height:${labelH}px;line-height:${labelH}px;text-align:center;font-weight:${s.weight}">N</div>` : '');
    },
    paint(c, elm, box, ctx) {
      const { u } = ctx;
      const s = elm.style;
      const labelH = s.showLabel === false ? 0 : u(s.size) * 1.35;
      const side = Math.max(4, Math.min(box.w, box.h - labelH));
      paintNorthGlyph(c, s.variant, s.color, box.x + box.w / 2, box.y + (box.h - labelH) / 2, side, -(state.mapView.bearing ?? 0));
      if (labelH) {
        setFont(c, s, u);
        c.fillStyle = s.color;
        c.textBaseline = 'top';
        const w = c.measureText('N').width;
        c.fillText('N', box.x + (box.w - w) / 2, box.y + box.h - labelH + u(s.size) * 0.12);
      }
    },
  },

  scale: {
    label: 'Scale bar', icon: '⊢', hint: 'Ground distance at the current zoom',
    inspect: ['scale', 'chrome'],
    defaults: { x: 68, y: 94, w: 26, h: 4.2 },
    style: { ...TEXT, ...PLAIN, size: 9, weight: 700, color: '#0f172a', align: 'left', variant: 'checker', thickness: 4 },
    dom(inner, elm, ctx) {
      const { u, mPerPx } = ctx;
      const s = elm.style;
      const inset = u(s.padding ?? 0) + u(s.borderWidth ?? 0);
      const avail = Math.max(20, inner.clientWidth - inset * 2 || inner.getBoundingClientRect().width - inset * 2);
      const bar = scaleBarFor(avail, mPerPx);
      const px = Math.max(12, bar.fraction * avail);
      const th = u(s.thickness ?? 4);
      let barHtml;
      if (s.variant === 'line') {
        barHtml = `<div style="width:${px}px;height:${th}px;border-left:${Math.max(1, th * 0.22)}px solid ${s.color};border-right:${Math.max(1, th * 0.22)}px solid ${s.color};border-bottom:${Math.max(1, th * 0.28)}px solid ${s.color}"></div>`;
      } else if (s.variant === 'bar') {
        barHtml = `<div style="width:${px}px;height:${th}px;background:${s.color};border-radius:${th * 0.2}px"></div>`;
      } else {
        const seg = px / 4;
        barHtml = `<div style="display:flex;width:${px}px;height:${th}px;border:${Math.max(0.6, th * 0.13)}px solid ${s.color};box-sizing:border-box">
          ${[0, 1, 2, 3].map((i) => `<span style="width:${seg}px;background:${i % 2 ? 'transparent' : s.color}"></span>`).join('')}
        </div>`;
      }
      inner.innerHTML = `<div style="display:flex;flex-direction:column;gap:${u(1.6)}px;align-items:${s.align === 'center' ? 'center' : s.align === 'right' ? 'flex-end' : 'flex-start'}">
        ${barHtml}<div style="font-weight:${s.weight}">${esc(bar.label)}</div></div>`;
    },
    paint(c, elm, box, ctx) {
      const { u, scale, mPerPx } = ctx;
      const s = elm.style;
      const screenW = box.w / (scale || 1);
      const bar = scaleBarFor(screenW, mPerPx);
      const px = Math.max(u(6), bar.fraction * box.w);
      const th = u(s.thickness ?? 4);
      const x0 = s.align === 'center' ? box.x + (box.w - px) / 2 : s.align === 'right' ? box.x + box.w - px : box.x;

      c.save();
      c.strokeStyle = s.color;
      c.fillStyle = s.color;
      if (s.variant === 'line') {
        c.lineWidth = Math.max(1, th * 0.24);
        c.beginPath();
        c.moveTo(x0, box.y);
        c.lineTo(x0, box.y + th);
        c.lineTo(x0 + px, box.y + th);
        c.lineTo(x0 + px, box.y);
        c.stroke();
      } else if (s.variant === 'bar') {
        roundRect(c, x0, box.y, px, th, th * 0.2);
        c.fill();
      } else {
        const seg = px / 4;
        for (let i = 0; i < 4; i++) {
          if (i % 2 === 0) c.fillRect(x0 + i * seg, box.y, seg, th);
        }
        c.lineWidth = Math.max(0.6, th * 0.13);
        c.strokeRect(x0, box.y, px, th);
      }
      c.restore();

      setFont(c, s, u);
      c.fillStyle = s.color;
      c.textBaseline = 'top';
      const tw = c.measureText(bar.label).width;
      const tx = s.align === 'center' ? box.x + (box.w - tw) / 2 : s.align === 'right' ? box.x + box.w - tw : box.x;
      c.fillText(bar.label, tx, box.y + th + u(1.8));
    },
  },

  /* ---------------------------------------------------------------- */
  neatline: {
    label: 'Neatline', icon: '▭', hint: 'A cartographic frame around the page',
    inspect: ['neatline'],
    defaults: { x: 2.5, y: 2.5, w: 95, h: 95 },
    style: { ...PLAIN, color: '#0f172a', borderWidth: 2, gap: 2.2, inner: true, innerWidth: 0.7 },
    dom(inner, elm, ctx) {
      const { u } = ctx;
      const s = elm.style;
      inner.style.border = `${Math.max(0.6, u(s.borderWidth))}px solid ${s.color}`;
      inner.innerHTML = s.inner
        ? `<div style="position:absolute;inset:${u(s.gap)}px;border:${Math.max(0.4, u(s.innerWidth))}px solid ${s.color}"></div>`
        : '';
      inner.style.position = 'absolute';
      inner.style.inset = '0';
    },
    paint(c, elm, box, ctx) {
      const { u } = ctx;
      const s = elm.style;
      c.save();
      c.strokeStyle = s.color;
      c.lineWidth = Math.max(0.6, u(s.borderWidth));
      c.strokeRect(box.x, box.y, box.w, box.h);
      if (s.inner) {
        const g = u(s.gap);
        c.lineWidth = Math.max(0.4, u(s.innerWidth));
        c.strokeRect(box.x + g, box.y + g, box.w - g * 2, box.h - g * 2);
      }
      c.restore();
    },
  },

  grid: {
    label: 'Grid & labels', icon: '#', hint: 'Latitude/longitude lines with coordinate labels at the edges',
    inspect: ['grid', 'type'],
    defaults: { x: 0, y: 0, w: 100, h: 100 },
    style: {
      ...TEXT, ...PLAIN, size: 10, weight: 700, color: '#1f2937',
      lineColor: '#334155', lineWidth: 0.9, lineOpacity: 0.7, dash: 'solid',
      showLines: true, showLabels: true, halo: true, labelPosition: 'outside',
      interval: 'auto', format: 'dms',
      labelTop: true, labelBottom: true, labelLeft: true, labelRight: true,
    },
    dom(inner, elm, ctx) {
      const box = boxOfNode(inner);
      const plan = box && gridPlan(elm);
      if (!plan) { inner.innerHTML = ''; return; }
      const s = elm.style;
      const { u } = ctx;
      const W = box.w;
      const H = box.h;
      const lw = Math.max(0.5, u(s.lineWidth));
      const dash = s.dash === 'dashed' ? `stroke-dasharray="${(lw * 5).toFixed(1)} ${(lw * 3.5).toFixed(1)}"` : '';
      const lines = s.showLines === false ? '' : plan.lines.map((l) =>
        `<line x1="${(l.a[0] * W).toFixed(2)}" y1="${(l.a[1] * H).toFixed(2)}" x2="${(l.b[0] * W).toFixed(2)}" y2="${(l.b[1] * H).toFixed(2)}" stroke="${s.lineColor}" stroke-opacity="${s.lineOpacity ?? 0.7}" stroke-width="${lw.toFixed(2)}" ${dash}/>`).join('');
      const fs = u(s.size);
      const family = esc(FONTS[s.font]?.stack ?? FONTS.sans.stack);
      const outside = s.labelPosition !== 'inside';
      const labels = s.showLabels === false ? '' : plan.labels.map((lb) => {
        const p = gridLabelPlacement(lb, W, H, fs, outside);
        const halo = s.halo ? `paint-order="stroke" stroke="#ffffff" stroke-width="${(fs * 0.28).toFixed(2)}" stroke-linejoin="round"` : '';
        const turn = p.rotate ? `transform="rotate(${p.rotate} ${p.x.toFixed(2)} ${p.y.toFixed(2)})"` : '';
        return `<text x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" ${turn} text-anchor="${p.anchor}" dominant-baseline="${p.baseline}" font-size="${fs.toFixed(2)}" font-weight="${s.weight ?? 600}" font-family="${family}" fill="${s.color}" ${halo}>${esc(lb.text)}</text>`;
      }).join('');
      // Lines are already clipped to the frame; labels outside it must not be.
      inner.style.overflow = outside ? 'visible' : 'hidden';
      inner.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" style="display:block;overflow:${outside ? 'visible' : 'hidden'}">${lines}${labels}</svg>`;
    },
    paint(c, elm, box, ctx) {
      const plan = gridPlan(elm);
      if (!plan) return;
      const s = elm.style;
      const { u } = ctx;
      const lw = Math.max(0.5, u(s.lineWidth));
      c.save();
      c.beginPath();
      c.rect(box.x, box.y, box.w, box.h);
      c.clip();
      if (s.showLines !== false) {
        c.strokeStyle = rgba(s.lineColor, s.lineOpacity ?? 0.7);
        c.lineWidth = lw;
        c.setLineDash(s.dash === 'dashed' ? [lw * 5, lw * 3.5] : []);
        for (const l of plan.lines) {
          c.beginPath();
          c.moveTo(box.x + l.a[0] * box.w, box.y + l.a[1] * box.h);
          c.lineTo(box.x + l.b[0] * box.w, box.y + l.b[1] * box.h);
          c.stroke();
        }
        c.setLineDash([]);
      }
      const outside = s.labelPosition !== 'inside';
      // Labels outside the frame are drawn after the clip is lifted.
      if (outside) { c.restore(); c.save(); }
      if (s.showLabels !== false) {
        const fs = u(s.size);
        c.font = `${s.italic ? 'italic ' : ''}${s.weight ?? 600} ${fs}px ${FONTS[s.font]?.stack ?? FONTS.sans.stack}`;
        for (const lb of plan.labels) {
          const p = gridLabelPlacement(lb, box.w, box.h, fs, outside);
          c.save();
          c.translate(box.x + p.x, box.y + p.y);
          if (p.rotate) c.rotate((p.rotate * Math.PI) / 180);
          c.textAlign = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left';
          c.textBaseline = p.baseline === 'hanging' ? 'top' : p.baseline === 'auto' ? 'alphabetic' : 'middle';
          if (s.halo) {
            c.lineJoin = 'round';
            c.strokeStyle = '#ffffff';
            c.lineWidth = fs * 0.28;
            c.strokeText(lb.text, 0, 0);
          }
          c.fillStyle = s.color;
          c.fillText(lb.text, 0, 0);
          c.restore();
        }
      }
      c.restore();
    },
  },

  inset: {
    label: 'Locator inset', icon: '⊞', hint: 'Where the study area sits in the wider region',
    inspect: ['inset', 'chrome'],
    defaults: { x: 68, y: 20, w: 26, h: 20 },
    style: {
      ...TEXT, ...CARD, size: 8, color: '#0f172a',
      fill: '#38bdf8', stroke: '#0369a1', fillOpacity: 0.55, padding: 5,
      context: 'auto', contextFill: '#e2e8f0', contextStroke: '#94a3b8', contextOpacity: 0.3,
      extent: false, extentStroke: '#dc2626',
      // A real map under the outlines, and the inset's own view of it.
      basemap: 'canvas-light', viewZoom: 0, viewPan: [0, 0],
    },
    dom(inner, elm, ctx) {
      // Measured, not derived. An element's `w` is a percentage of page width
      // and its `h` a percentage of page *height*, so w/h is not its aspect
      // ratio on any paper that is not square — and an inset drawn to the
      // wrong aspect is an outline of the wrong shape. The node is positioned
      // before this runs, so its real pixel box is there to be read, and using
      // it makes the preview identical to the canvas path by construction.
      // Padding and border come off it, because that is the box the drawing
      // gets — the same content box the canvas path is handed.
      const outer = boxOfNode(inner);
      const pad = ctx?.u ? ctx.u(elm.style.padding ?? 0) + ctx.u(elm.style.borderWidth ?? 0) : 0;
      const measured = outer && outer.w - pad * 2 > 2 && outer.h - pad * 2 > 2
        ? { x: 0, y: 0, w: outer.w - pad * 2, h: outer.h - pad * 2 }
        : outer;
      const plan = insetPlan(elm, measured);
      if (!plan) {
        inner.innerHTML = '<div style="height:100%;display:grid;place-items:center;opacity:.5;text-align:center">Load a study area</div>';
        return;
      }
      const s = elm.style;
      // The viewBox matches the element's own proportions and the projection
      // is aspect-correct inside it, so the preview is the print. It used to
      // be a square viewBox stretched with preserveAspectRatio="none", which
      // squashed every outline on screen by exactly the amount the element was
      // off square — and then printed it correctly, so the two disagreed.
      const { W, H, context, area, extent, stroke, tiles } = plan;
      const path = (rings) => (rings ?? [])
        .map((r) => `M${r.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}Z`).join('');
      const pct = (v, of) => `${((v / of) * 100).toFixed(4)}%`;
      // Tiles are placed in percent of the drawing, with a hair of overlap so
      // no seam shows between them at fractional sizes.
      const tileHtml = (tiles ?? []).map((t) => `<img src="${esc(t.url)}" alt="" draggable="false" crossorigin="anonymous" style="position:absolute;left:${pct(t.x, W)};top:${pct(t.y, H)};width:calc(${pct(t.size, W)} + 0.6px);height:calc(${pct(t.size, H)} + 0.6px);max-width:none;user-select:none;pointer-events:none">`).join('');
      const contextOpacity = tiles ? (s.contextOpacity ?? 0.3) : 1;

      inner.innerHTML = `<div class="inset-view" style="position:relative;width:100%;height:100%;overflow:hidden">
        ${tileHtml}
        <svg viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;display:block">
        ${context ? `<path d="${path(context)}" fill="${rgba(s.contextFill, contextOpacity)}" stroke="${s.contextStroke}" stroke-width="${stroke * 0.75}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : ''}
        <path d="${path(area)}" fill="${rgba(s.fill, s.fillOpacity)}" stroke="${s.stroke}" stroke-width="${stroke}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
        ${extent ? `<rect x="${extent.x.toFixed(2)}" y="${extent.y.toFixed(2)}" width="${extent.w.toFixed(2)}" height="${extent.h.toFixed(2)}" fill="none" stroke="${s.extentStroke}" stroke-width="${stroke}" vector-effect="non-scaling-stroke"/>` : ''}
        </svg>
      </div>`;
    },
    paint(c, elm, box, ctx) {
      const plan = insetPlan(elm, box);
      if (!plan) return;
      const s = elm.style;
      const w = Math.max(0.7, ctx.u(0.8));

      // Basemap tiles first, clipped to the box. They were fetched by
      // preloadInsetTiles() before the export started painting; any that
      // failed are skipped rather than holding the export up.
      c.save();
      c.beginPath();
      c.rect(box.x, box.y, box.w, box.h);
      c.clip();
      if (plan.tiles) {
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        for (const t of plan.tiles) {
          const img = tileImage(t.url);
          if (!tileReady(img)) continue;
          try { c.drawImage(img, t.x, t.y, t.size + 0.5, t.size + 0.5); } catch { /* tainted or broken tile */ }
        }
      }
      paintInsetShapes(c, s, plan, w);
      c.restore();
    },
  },

  shape: {
    label: 'Shape', icon: '◇', hint: 'Rectangle, circle, line, arrow or star',
    inspect: ['shape'],
    defaults: { x: 40, y: 45, w: 16, h: 12 },
    style: {
      ...PLAIN,
      variant: 'rectangle',
      fill: '#0369a1', fillOpacity: 0.18,
      stroke: '#0369a1', strokeWidth: 1.6,
      radius: 2, rotation: 0, dash: 'solid',
    },
    dom(inner, elm, ctx) {
      inner.innerHTML = shapeSvg(elm.style, ctx.u);
    },
    paint(c, elm, box, ctx) {
      paintShape(c, elm.style, box, ctx.u);
    },
  },

  logo: {
    label: 'Logo / image', icon: '▣', hint: 'Drop in an organisation logo',
    inspect: ['logo', 'chrome'],
    defaults: { x: 84, y: 88, w: 11, h: 8 },
    style: { ...PLAIN, src: '', fit: 'contain' },
    dom(inner, elm) {
      const src = elm.style.src;
      inner.innerHTML = src
        ? `<img src="${esc(src)}" style="width:100%;height:100%;object-fit:${elm.style.fit};display:block" alt="" />`
        : `<div style="height:100%;display:grid;place-items:center;border:1px dashed #cbd5e1;border-radius:6px;color:#94a3b8;font-size:9px;text-align:center">Add image</div>`;
    },
    paint(c, elm, box) {
      const img = elm._img;
      if (!img || !img.complete || !img.naturalWidth) return;
      const k = elm.style.fit === 'cover'
        ? Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight)
        : Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight);
      const w = img.naturalWidth * k;
      const h = img.naturalHeight * k;
      c.save();
      c.beginPath();
      c.rect(box.x, box.y, box.w, box.h);
      c.clip();
      c.drawImage(img, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
      c.restore();
    },
  },
};

/** Order shown in the "Add element" panel. */
export const ELEMENT_ORDER = [
  'title', 'subtitle', 'text', 'legend', 'stats', 'metadata',
  'north', 'scale', 'inset', 'shape', 'logo', 'neatline', 'grid', 'credits',
];

/* ------------------------------------------------------------------ */
/* factory + renderers                                                 */
/* ------------------------------------------------------------------ */

/** Build an element instance, merging template or user overrides. */
export function createElement(type, patch = {}) {
  const def = ELEMENT_TYPES[type];
  if (!def) throw new Error(`Unknown element type "${type}"`);
  const { style: stylePatch, ...rest } = patch;
  return {
    ...def.defaults,
    ...rest,
    id: patch.id ?? uid('el'),
    type,
    locked: patch.locked ?? false,
    hidden: patch.hidden ?? false,
    style: { ...def.style, ...(stylePatch ?? {}) },
  };
}

export const elementLabel = (elm) => ELEMENT_TYPES[elm.type]?.label ?? elm.type;

/**
 * Draw an element on screen.
 * @param {HTMLElement} inner  the `.el-inner` node
 * @param {object} elm
 * @param {{u: (pt:number)=>number, mPerPx: number}} ctx
 */
export function renderElementDom(inner, elm, ctx) {
  const def = ELEMENT_TYPES[elm.type];
  if (!def) return;
  inner.replaceChildren();
  inner.removeAttribute('style');
  if (elm.type !== 'neatline') chromeDom(inner, elm.style, ctx.u);
  def.dom(inner, elm, ctx);
}

/**
 * Draw an element into the export canvas.
 * @param {CanvasRenderingContext2D} c
 * @param {object} elm
 * @param {{x:number,y:number,w:number,h:number}} box  the element's page rect
 * @param {object} ctx  render context from derive.buildRenderContext()
 */
export function paintElement(c, elm, box, ctx) {
  const def = ELEMENT_TYPES[elm.type];
  if (!def) return;
  c.save();
  if (elm.type === 'neatline') {
    def.paint(c, elm, box, ctx);
  } else {
    paintChrome(c, box, elm.style, ctx.u);
    def.paint(c, elm, contentBox(box, elm.style, ctx.u), ctx);
  }
  c.restore();
}

/** Preload any images an element needs before an export pass. */
export function preloadElementAssets(elements) {
  const jobs = [];
  for (const elm of elements) {
    if (elm.type !== 'logo' || !elm.style.src) continue;
    jobs.push(new Promise((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => { elm._img = img; resolve(); };
      img.src = elm.style.src;
    }));
  }
  return Promise.all(jobs);
}
