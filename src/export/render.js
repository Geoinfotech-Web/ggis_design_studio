/**
 * Export pipeline.
 *
 * Crops the live WebGL canvas to exactly the artboard rectangle, scales it
 * to the chosen paper size at the chosen dpi, re-applies the template's
 * look filter and texture, then paints every element on top using the
 * canvas renderers in layout/elements.js.
 *
 * The crop is the reason `preserveDrawingBuffer: true` is set on the map.
 */

import { state } from '../core/store.js';
import { getMap, lookFilter } from '../core/map.js';
import { APP } from '../core/constants.js';
import { buildRenderContext } from '../layout/derive.js';
import { paintElement, preloadElementAssets } from '../layout/elements.js';
import { paperDims, artboardRect } from '../ui/artboard.js';

/** Refuse absurd canvases rather than crashing the tab. */
const MAX_PIXELS = 48e6;

/** Wait for the map to finish drawing, but never hang the export. */
function mapIdle(timeout = 2500) {
  const map = getMap();
  if (!map) return Promise.resolve();
  if (map.loaded() && !map.isMoving()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); map.off('idle', done); resolve(); };
    const timer = setTimeout(done, timeout);
    map.on('idle', done);
  });
}

/* ------------------------------------------------------------------ */
/* textures                                                            */
/* ------------------------------------------------------------------ */
function textureTile(kind, scale) {
  const size = 128;
  const tile = document.createElement('canvas');
  tile.width = tile.height = size;
  const c = tile.getContext('2d');

  if (kind === 'paper') {
    // Deterministic speckle — a paper grain that survives scaling.
    for (let i = 0; i < 2600; i++) {
      const x = (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1 * size;
      const y = (Math.sin(i * 78.233) * 12345.6789 % 1 + 1) % 1 * size;
      const a = 0.03 + ((i % 7) / 7) * 0.05;
      c.fillStyle = i % 3 === 0 ? `rgba(255,255,255,${a})` : `rgba(90,74,52,${a})`;
      c.fillRect(x, y, 1.2, 1.2);
    }
  } else if (kind === 'linen') {
    c.strokeStyle = 'rgba(80,70,55,0.07)';
    c.lineWidth = Math.max(0.6, scale * 0.6);
    for (let i = 0; i < size; i += 4) {
      c.beginPath(); c.moveTo(i, 0); c.lineTo(i, size); c.stroke();
      c.beginPath(); c.moveTo(0, i); c.lineTo(size, i); c.stroke();
    }
  } else if (kind === 'halftone') {
    c.fillStyle = 'rgba(15,23,42,0.07)';
    for (let y = 3; y < size; y += 7) {
      for (let x = 3; x < size; x += 7) {
        c.beginPath();
        c.arc(x + (y % 14 === 3 ? 0 : 3.5), y, 1.5, 0, Math.PI * 2);
        c.fill();
      }
    }
  } else {
    return null;
  }
  return tile;
}

function paintTexture(c, kind, W, H, scale) {
  const tile = textureTile(kind, scale);
  if (!tile) return;
  const pattern = c.createPattern(tile, 'repeat');
  if (!pattern) return;
  c.save();
  c.scale(scale, scale);
  c.fillStyle = pattern;
  c.fillRect(0, 0, W / scale, H / scale);
  c.restore();
}

function paintVignette(c, W, H, amount) {
  if (!amount) return;
  const inner = Math.max(0.2, 0.7 - amount * 0.45);
  c.save();
  c.translate(W / 2, H / 2);
  c.scale(1, H / W);
  const r = W * 0.72;
  const grad = c.createRadialGradient(0, 0, r * inner, 0, 0, r);
  grad.addColorStop(0, 'rgba(15,23,42,0)');
  grad.addColorStop(1, `rgba(15,23,42,${(amount * 0.55).toFixed(3)})`);
  c.fillStyle = grad;
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/* ------------------------------------------------------------------ */
/* composition                                                         */
/* ------------------------------------------------------------------ */

/**
 * Render the current page to an off-screen canvas.
 * @param {{ dpi?: number, onProgress?: (msg: string) => void }} [opts]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function composeExport(opts = {}) {
  const dpi = opts.dpi ?? state.page.dpi ?? 150;
  const { wIn, hIn } = paperDims();

  let W = Math.round(wIn * dpi);
  let H = Math.round(hIn * dpi);
  if (W * H > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (W * H));
    W = Math.round(W * k);
    H = Math.round(H * k);
  }

  opts.onProgress?.('Waiting for the map to finish drawing…');
  await Promise.all([mapIdle(), document.fonts?.ready ?? Promise.resolve(), preloadElementAssets(state.elements)]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');

  c.fillStyle = state.page.background ?? '#ffffff';
  c.fillRect(0, 0, W, H);

  /* --- the map, cropped to the artboard --------------------------- */
  opts.onProgress?.('Cropping the page area…');
  const map = getMap();
  const rect = artboardRect();
  if (map && rect.w > 0) {
    const mapCanvas = map.getCanvas();
    const ratio = mapCanvas.width / mapCanvas.clientWidth;
    const filter = lookFilter(state.mapLook);
    c.save();
    if (filter && filter !== 'none') c.filter = filter;
    try {
      c.drawImage(
        mapCanvas,
        rect.x * ratio, rect.y * ratio, rect.w * ratio, rect.h * ratio,
        0, 0, W, H,
      );
    } catch (err) {
      console.error('[export] could not read the map canvas', err);
    }
    c.restore();
  }

  paintVignette(c, W, H, Number(state.mapLook?.vignette ?? 0));
  if (state.mapLook?.texture && state.mapLook.texture !== 'none') {
    paintTexture(c, state.mapLook.texture, W, H, Math.max(1, W / 1400));
  }

  /* --- elements ---------------------------------------------------- */
  opts.onProgress?.('Drawing map elements…');
  const ctx = buildRenderContext({ W, H, artWScreen: rect.w || W, media: 'export' });
  for (const elm of state.elements) {
    if (elm.hidden) continue;
    const box = {
      x: (elm.x / 100) * W,
      y: (elm.y / 100) * H,
      w: (elm.w / 100) * W,
      h: (elm.h / 100) * H,
    };
    try {
      paintElement(c, elm, box, ctx);
    } catch (err) {
      console.error(`[export] element "${elm.type}" failed to draw`, err);
    }
  }

  return canvas;
}

/* ------------------------------------------------------------------ */
/* outputs                                                             */
/* ------------------------------------------------------------------ */
const safeName = () => (state.projectName || 'map').replace(/[^\w\-. ]+/g, '').trim() || 'map';

function download(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

/** Export a PNG at the page's dpi. */
export async function exportPng(opts = {}) {
  const canvas = await composeExport(opts);
  opts.onProgress?.('Encoding PNG…');
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const url = URL.createObjectURL(blob);
  download(url, `${safeName()}.png`);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { width: canvas.width, height: canvas.height, bytes: blob.size };
}

/** Export a single-page PDF at the exact paper size. */
export async function exportPdf(opts = {}) {
  const canvas = await composeExport(opts);
  opts.onProgress?.('Building PDF…');
  const { jsPDF } = await import('jspdf');
  const { wIn, hIn, orientation } = paperDims();

  const doc = new jsPDF({
    orientation: orientation === 'portrait' ? 'portrait' : 'landscape',
    unit: 'in',
    format: [wIn, hIn],
    compress: true,
  });
  doc.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, wIn, hIn, undefined, 'FAST');
  doc.setProperties({
    title: state.projectName || 'Map',
    creator: `${APP.name} ${APP.version}`,
    author: APP.org,
  });
  doc.save(`${safeName()}.pdf`);
  return { width: canvas.width, height: canvas.height };
}

/** A small preview data URL — used for the "recent projects" thumbnail. */
export async function thumbnailDataUrl(maxWidth = 420) {
  const canvas = await composeExport({ dpi: 72 });
  const scale = Math.min(1, maxWidth / canvas.width);
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.72);
}
