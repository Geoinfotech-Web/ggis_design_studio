/**
 * The shape gallery — the graphics palette of a desktop GIS layout: lines,
 * a point, polygons and arrows.
 *
 * Every shape is described once, on a unit square (0–1 across, 0–1 down), as
 * a list of path operations. It is then mapped into the element's real pixel
 * box and drawn by both renderers — the screen's SVG and the export's canvas
 * — from the very same geometry. Building in pixels rather than stretching a
 * fixed viewBox is what keeps a line the same weight on every side and an
 * arrowhead the right shape however the box is stretched.
 *
 * `flipX` / `flipY` record which way a shape was dragged out, so a line or
 * an arrow drawn from bottom-right to top-left points the way it was drawn.
 */

const K = 0.5523; // control-point distance for a quarter ellipse as a cubic

/** Path ops: ['M',x,y] ['L',x,y] ['Q',cx,cy,x,y] ['C',ax,ay,bx,by,x,y] ['Z'] */
const ellipseOps = (cx, cy, rx, ry) => [
  ['M', cx + rx, cy],
  ['C', cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry],
  ['C', cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy],
  ['C', cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry],
  ['C', cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy],
  ['Z'],
];
const poly = (pts) => [['M', ...pts[0]], ...pts.slice(1).map((p) => ['L', ...p]), ['Z']];
const open = (pts) => [['M', ...pts[0]], ...pts.slice(1).map((p) => ['L', ...p])];

function starPoints() {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 ? 0.21 : 0.5;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r * 1.02]);
  }
  return pts;
}

function cloudOps() {
  // Bumps round an ellipse: each bump a cubic bulging outwards.
  const n = 9;
  const ops = [];
  const at = (t, k = 1) => [0.5 + Math.cos(t) * 0.42 * k, 0.53 + Math.sin(t) * 0.36 * k];
  for (let i = 0; i <= n; i += 1) {
    const t0 = (i / n) * Math.PI * 2;
    const t1 = ((i + 1) / n) * Math.PI * 2;
    const [x0, y0] = at(t0);
    const [x1, y1] = at(t1);
    const [ax, ay] = at(t0 + (t1 - t0) * 0.15, 1.32);
    const [bx, by] = at(t0 + (t1 - t0) * 0.85, 1.32);
    if (i === 0) ops.push(['M', x0, y0]);
    if (i < n) ops.push(['C', ax, ay, bx, by, x1, y1]);
  }
  ops.push(['Z']);
  return ops;
}

/**
 * The catalogue. `kind` decides how a shape is styled and drawn:
 *   line    — stroked only
 *   point   — a filled marker, drawn square
 *   polygon — fill and outline
 *   arrow   — stroked, with arrowheads at `heads` (each a tip and the point
 *             the line arrives from, which sets the head's direction)
 */
export const SHAPES = {
  // Lines
  straight:   { label: 'Straight line', group: 'Line', kind: 'line', ops: () => open([[0, 0], [1, 1]]) },
  polyline:   { label: 'Polyline', group: 'Line', kind: 'line', ops: () => open([[0, 1], [0.3, 0.35], [0.56, 0.7], [1, 0]]) },
  curve:      { label: 'Curve', group: 'Line', kind: 'line', ops: () => [['M', 0, 0.8], ['C', 0.3, -0.2, 0.62, 1.2, 1, 0.2]] },
  freehand:   {
    label: 'Freehand', group: 'Line', kind: 'line',
    ops: () => [['M', 0, 0.6], ['C', 0.12, 0.05, 0.3, 0.05, 0.34, 0.45], ['C', 0.38, 0.85, 0.56, 0.9, 0.6, 0.5], ['C', 0.64, 0.12, 0.84, 0.08, 0.88, 0.42], ['C', 0.91, 0.66, 1, 0.62, 1, 0.5]],
  },
  arc:        { label: 'Arc', group: 'Line', kind: 'line', ops: () => [['M', 0, 1], ['C', 0, 0.45, 0.45, 0, 1, 0]] },
  line:       { label: 'Horizontal line', group: 'Line', kind: 'line', ops: () => open([[0, 0.5], [1, 0.5]]) },

  // Point
  point:      { label: 'Point', group: 'Point', kind: 'point', ops: () => ellipseOps(0.5, 0.5, 0.5, 0.5) },

  // Polygons
  rectangle:  { label: 'Rectangle', group: 'Polygon', kind: 'polygon', ops: () => poly([[0, 0], [1, 0], [1, 1], [0, 1]]) },
  polygon:    { label: 'Polygon', group: 'Polygon', kind: 'polygon', ops: () => poly([[0, 0], [0.5, 0.38], [1, 0], [1, 1], [0, 1]]) },
  circle:     { label: 'Circle', group: 'Polygon', kind: 'polygon', square: true, ops: () => ellipseOps(0.5, 0.5, 0.5, 0.5) },
  ellipse:    { label: 'Ellipse', group: 'Polygon', kind: 'polygon', ops: () => ellipseOps(0.5, 0.5, 0.5, 0.5) },
  blob:       {
    label: 'Freehand polygon', group: 'Polygon', kind: 'polygon',
    ops: () => [['M', 0.32, 0.02], ['C', 0.58, -0.02, 0.68, 0.22, 0.74, 0.34], ['C', 0.95, 0.4, 1.02, 0.74, 0.84, 0.94], ['C', 0.64, 1.06, 0.32, 0.9, 0.16, 0.8], ['C', -0.04, 0.66, 0.02, 0.06, 0.32, 0.02], ['Z']],
  },
  rounded:    { label: 'Rounded rectangle', group: 'Polygon', kind: 'polygon', rounded: true, ops: () => [] },
  triangle:   { label: 'Triangle', group: 'Polygon', kind: 'polygon', ops: () => poly([[0.5, 0], [1, 1], [0, 1]]) },
  'right-triangle': { label: 'Right triangle', group: 'Polygon', kind: 'polygon', ops: () => poly([[0, 0], [1, 1], [0, 1]]) },
  plus:       {
    label: 'Plus', group: 'Polygon', kind: 'polygon',
    ops: () => poly([[0.33, 0], [0.67, 0], [0.67, 0.33], [1, 0.33], [1, 0.67], [0.67, 0.67], [0.67, 1], [0.33, 1], [0.33, 0.67], [0, 0.67], [0, 0.33], [0.33, 0.33]]),
  },
  cross:      {
    label: 'Cross (×)', group: 'Polygon', kind: 'polygon',
    ops: () => poly([[0.2, 0], [0.5, 0.3], [0.8, 0], [1, 0.2], [0.7, 0.5], [1, 0.8], [0.8, 1], [0.5, 0.7], [0.2, 1], [0, 0.8], [0.3, 0.5], [0, 0.2]]),
  },
  cloud:      { label: 'Cloud', group: 'Polygon', kind: 'polygon', ops: cloudOps },
  diamond:    { label: 'Diamond', group: 'Polygon', kind: 'polygon', ops: () => poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]) },
  star:       { label: 'Star', group: 'Polygon', kind: 'polygon', ops: () => poly(starPoints()) },
  arrow:      { label: 'Block arrow', group: 'Polygon', kind: 'polygon', ops: () => poly([[0, 0.36], [0.64, 0.36], [0.64, 0.14], [1, 0.5], [0.64, 0.86], [0.64, 0.64], [0, 0.64]]) },

  // Arrows
  'arrow-line':   { label: 'Arrow', group: 'Arrow', kind: 'arrow', ops: () => open([[0, 0], [1, 1]]), heads: [{ tip: [1, 1], from: [0, 0] }] },
  'arrow-curve':  {
    label: 'Curved arrow', group: 'Arrow', kind: 'arrow',
    ops: () => [['M', 0, 0.2], ['C', 0.62, -0.1, 0.3, 1, 1, 0.8]],
    heads: [{ tip: [1, 0.8], from: [0.3, 1] }],
  },
  'arrow-double': {
    label: 'Double arrow', group: 'Arrow', kind: 'arrow', ops: () => open([[0, 0], [1, 1]]),
    heads: [{ tip: [1, 1], from: [0, 0] }, { tip: [0, 0], from: [1, 1] }],
  },
  'arrow-curve-double': {
    label: 'Curved double arrow', group: 'Arrow', kind: 'arrow',
    ops: () => [['M', 0, 0.8], ['C', 0.36, 0.8, 0.64, 0.2, 1, 0.2]],
    heads: [{ tip: [1, 0.2], from: [0.64, 0.2] }, { tip: [0, 0.8], from: [0.36, 0.8] }],
  },
};

/** Gallery order, by group, as the Elements panel shows it. */
export const SHAPE_GROUPS = [
  { id: 'Line', items: ['straight', 'polyline', 'curve', 'freehand', 'arc'] },
  { id: 'Point', items: ['point'] },
  { id: 'Polygon', items: ['rectangle', 'polygon', 'circle', 'ellipse', 'blob', 'rounded', 'triangle', 'right-triangle', 'plus', 'cross', 'cloud', 'diamond', 'star', 'arrow'] },
  { id: 'Arrow', items: ['arrow-line', 'arrow-curve', 'arrow-double', 'arrow-curve-double'] },
];

export const shapeSpec = (variant) => SHAPES[variant] ?? SHAPES.rectangle;
export const shapeKind = (variant) => shapeSpec(variant).kind;

/** Style a freshly drawn shape starts with, by kind. */
export function shapeDefaults(variant) {
  switch (shapeKind(variant)) {
    case 'line':  return { variant, fill: '#0369a1', fillOpacity: 0, stroke: '#0f172a', strokeWidth: 2, dash: 'solid' };
    case 'arrow': return { variant, fill: '#0f172a', fillOpacity: 0, stroke: '#0f172a', strokeWidth: 2.2, dash: 'solid' };
    case 'point': return { variant, fill: '#dc2626', fillOpacity: 1, stroke: '#ffffff', strokeWidth: 1.2, dash: 'solid' };
    default:      return { variant, fill: '#0369a1', fillOpacity: 0.25, stroke: '#0369a1', strokeWidth: 1.6, dash: 'solid' };
  }
}

/**
 * The shape in pixels: path ops, whether it may be filled, and its
 * arrowheads as filled triangles.
 * @param {object} s  element style
 * @param {number} W  box width in px
 * @param {number} H  box height in px
 * @param {number} stroke  stroke width in px
 */
export function shapeGeometry(s, W, H, stroke) {
  const spec = shapeSpec(s.variant);
  const headLen = spec.heads ? Math.max(stroke * 4.2, 7) : 0;
  // Keep the stroke, and any arrowhead, inside the box.
  const pad = Math.min(W, H) / 2 - 0.5 > 0
    ? Math.min(Math.max(stroke / 2, headLen * 0.55, 1), Math.min(W, H) / 2 - 0.5)
    : 0;
  const iw = Math.max(1, W - pad * 2);
  const ih = Math.max(1, H - pad * 2);
  const fx = s.flipX ? (u) => 1 - u : (u) => u;
  const fy = s.flipY ? (v) => 1 - v : (v) => v;
  const X = (u) => pad + fx(u) * iw;
  const Y = (v) => pad + fy(v) * ih;

  let ops;
  if (spec.rounded || (s.variant === 'rectangle' && (s.radius ?? 0) > 0)) {
    // `radius` keeps its old meaning: a share of the shorter side, 0–40.
    const r = spec.rounded
      ? Math.min(iw, ih) * 0.22
      : Math.min(((s.radius ?? 0) / 100) * Math.min(iw, ih), iw / 2, ih / 2);
    const x0 = pad; const y0 = pad; const x1 = pad + iw; const y1 = pad + ih;
    ops = [
      ['M', x0 + r, y0], ['L', x1 - r, y0], ['Q', x1, y0, x1, y0 + r], ['L', x1, y1 - r], ['Q', x1, y1, x1 - r, y1],
      ['L', x0 + r, y1], ['Q', x0, y1, x0, y1 - r], ['L', x0, y0 + r], ['Q', x0, y0, x0 + r, y0], ['Z'],
    ];
  } else {
    ops = spec.ops().map((op) => {
      if (op[0] === 'Z') return op;
      const out = [op[0]];
      for (let i = 1; i < op.length; i += 2) out.push(X(op[i]), Y(op[i + 1]));
      return out;
    });
  }

  const heads = (spec.heads ?? []).map(({ tip, from }) => {
    const tx = X(tip[0]); const ty = Y(tip[1]);
    const a = Math.atan2(ty - Y(from[1]), tx - X(from[0]));
    const half = headLen * 0.42;
    const bx = tx - Math.cos(a) * headLen;
    const by = ty - Math.sin(a) * headLen;
    return {
      tip: [tx, ty],
      left: [bx + Math.cos(a + Math.PI / 2) * half, by + Math.sin(a + Math.PI / 2) * half],
      right: [bx + Math.cos(a - Math.PI / 2) * half, by + Math.sin(a - Math.PI / 2) * half],
      // The line stops at the head's base, so a thick stroke does not poke
      // through the point of the arrow.
      base: [bx, by],
    };
  });

  return { ops, fillable: spec.kind === 'polygon' || spec.kind === 'point', heads, kind: spec.kind };
}

/** Pull the end of an open path back to an arrowhead's base. */
function trimToHeads(ops, heads) {
  if (!heads.length) return ops;
  const out = ops.map((op) => [...op]);
  const near = (x, y, p) => Math.hypot(x - p[0], y - p[1]) < 0.5;
  for (const h of heads) {
    const last = out[out.length - 1];
    const lx = last[last.length - 2]; const ly = last[last.length - 1];
    if (near(lx, ly, h.tip)) { last[last.length - 2] = h.base[0]; last[last.length - 1] = h.base[1]; continue; }
    const first = out[0];
    if (near(first[1], first[2], h.tip)) { first[1] = h.base[0]; first[2] = h.base[1]; }
  }
  return out;
}

const dashFor = (dash, stroke) => (dash === 'dashed' ? [stroke * 3, stroke * 2] : dash === 'dotted' ? [Math.max(0.5, stroke * 0.8), stroke * 2.2] : []);

/** The path as an SVG `d` string. */
export function opsToD(ops) {
  return ops.map((op) => (op[0] === 'Z' ? 'Z' : `${op[0]}${op.slice(1).map((n) => n.toFixed(2)).join(',')}`)).join('');
}

/** Replay path ops onto a canvas, offset by (ox, oy). */
function opsToCanvas(c, ops, ox, oy) {
  for (const op of ops) {
    switch (op[0]) {
      case 'M': c.moveTo(ox + op[1], oy + op[2]); break;
      case 'L': c.lineTo(ox + op[1], oy + op[2]); break;
      case 'Q': c.quadraticCurveTo(ox + op[1], oy + op[2], ox + op[3], oy + op[4]); break;
      case 'C': c.bezierCurveTo(ox + op[1], oy + op[2], ox + op[3], oy + op[4], ox + op[5], oy + op[6]); break;
      default: c.closePath();
    }
  }
}

/**
 * The shape as an SVG, sized in pixels.
 * @param {object} s  element style (fill, fillOpacity, stroke, strokeWidth, dash, rotation, flipX, flipY)
 * @param {number} W
 * @param {number} H
 * @param {number} stroke  px
 * @param {(color:string, opacity:number)=>string} rgba
 */
export function shapeSvgPx(s, W, H, stroke, rgba) {
  const g = shapeGeometry(s, W, H, stroke);
  const ops = g.kind === 'arrow' ? trimToHeads(g.ops, g.heads) : g.ops;
  const fill = g.fillable && (s.fillOpacity ?? 0) > 0 ? rgba(s.fill, s.fillOpacity) : 'none';
  const dash = dashFor(s.dash, stroke);
  const strokeAttr = stroke > 0
    ? `stroke="${s.stroke}" stroke-width="${stroke.toFixed(2)}"${dash.length ? ` stroke-dasharray="${dash.map((d) => d.toFixed(2)).join(' ')}"` : ''}`
    : 'stroke="none"';
  const heads = g.heads.map((h) => `<polygon points="${[h.tip, h.left, h.right].map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')}" fill="${s.stroke}"/>`).join('');
  const spin = s.rotation ? ` transform="rotate(${s.rotation} ${(W / 2).toFixed(2)} ${(H / 2).toFixed(2)})"` : '';
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" style="display:block;overflow:visible"><g${spin}><path d="${opsToD(ops)}" fill="${fill}" ${strokeAttr} stroke-linejoin="round" stroke-linecap="round"/>${heads}</g></svg>`;
}

/** The shape onto an export canvas, in `box` (px). */
export function paintShapePx(c, s, box, stroke, rgba) {
  const g = shapeGeometry(s, box.w, box.h, stroke);
  const ops = g.kind === 'arrow' ? trimToHeads(g.ops, g.heads) : g.ops;
  c.save();
  if (s.rotation) {
    c.translate(box.x + box.w / 2, box.y + box.h / 2);
    c.rotate((s.rotation * Math.PI) / 180);
    c.translate(-(box.x + box.w / 2), -(box.y + box.h / 2));
  }
  c.beginPath();
  opsToCanvas(c, ops, box.x, box.y);
  if (g.fillable && (s.fillOpacity ?? 0) > 0) {
    c.fillStyle = rgba(s.fill, s.fillOpacity);
    c.fill();
  }
  if (stroke > 0) {
    c.lineWidth = stroke;
    c.strokeStyle = s.stroke;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.setLineDash(dashFor(s.dash, stroke));
    c.stroke();
    c.setLineDash([]);
  }
  for (const h of g.heads) {
    c.beginPath();
    c.moveTo(box.x + h.tip[0], box.y + h.tip[1]);
    c.lineTo(box.x + h.left[0], box.y + h.left[1]);
    c.lineTo(box.x + h.right[0], box.y + h.right[1]);
    c.closePath();
    c.fillStyle = s.stroke;
    c.fill();
  }
  c.restore();
}

/** A small icon of a shape for the gallery, as an SVG string. */
export function shapeIconSvg(variant, size = 22) {
  const s = { ...shapeDefaults(variant), fill: 'currentColor', stroke: 'currentColor', fillOpacity: 1, strokeWidth: 1.6, flipX: false, flipY: false };
  // Drawn in the button's text colour, fills at a third so outlines read.
  return shapeSvgPx(s, size, size, 1.6, () => 'currentColor')
    .replace('<path d=', '<path fill-opacity="0.35" d=')
    .replace('style="display:block;overflow:visible"', 'style="display:block;overflow:visible" aria-hidden="true"');
}
