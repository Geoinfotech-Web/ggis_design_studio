/**
 * Derived content for "smart" elements.
 *
 * The legend, stats, metadata, scale bar and credits elements do not
 * store their own text — they read the live document, so adding a layer
 * or running an analysis updates the printed map automatically. Users
 * can still override any of it in the inspector.
 */

import { state } from '../core/store.js';
import { collectLegend } from '../layers/registry.js';
import { APP, PAPER_SIZES, ATTRIBUTION_TEXT } from '../core/constants.js';
import { formatArea, formatNumber, formatDMS, metresPerPixel, niceScaleBar } from '../core/geo.js';

/** Legend rows for the current document. */
export function legendRows() {
  return collectLegend().map(({ label, color, swatch }) => ({
    label,
    color,
    swatch: swatch === 'ramp' ? 'polygon' : swatch ?? 'polygon',
  }));
}

/** Study-area / analysis statistics as label → value rows. */
export function statsRows() {
  const rows = [];
  const sa = state.studyArea;
  if (sa) {
    rows.push({ label: 'Study area', value: sa.name, emphasis: true });
    rows.push({ label: 'Approx. area', value: formatArea(sa.areaKm2) });
  }

  const dataLayers = state.layers.filter((l) => l.source === 'osm' || l.source === 'upload');
  if (dataLayers.length) {
    const total = dataLayers.reduce((sum, l) => sum + (l.meta?.count ?? 0), 0);
    rows.push({ label: 'Mapped features', value: formatNumber(total, 0) });
  }

  const run = state.analysisRuns[state.analysisRuns.length - 1];
  if (run) {
    const s = run.result.stats ?? {};
    if (s.classes?.length) {
      const top = s.classes[0];
      rows.push({ label: `Largest class`, value: `${top.label} · ${top.share.toFixed(1)}%` });
    }
    if (Number.isFinite(s.total)) rows.push({ label: 'Detected extent', value: `${formatNumber(s.total)} km²` });
    if (Number.isFinite(s.mean)) rows.push({ label: `Mean ${run.job.unit ?? 'value'}`, value: s.mean.toFixed(2) });
    if (Number.isFinite(s.gained)) rows.push({ label: 'New built-up', value: `${formatNumber(s.gained)} km²` });
  }

  if (!rows.length) rows.push({ label: 'Study area', value: 'Not set yet', muted: true });
  return rows;
}

/** Map-information block: who, when, what projection, which sources. */
export function metadataRows() {
  const paper = PAPER_SIZES[state.page.size];
  const { center, zoom } = state.mapView;
  const sources = new Set();
  if (state.layers.some((l) => l.source === 'osm' || l.source === 'boundary')) sources.add('OpenStreetMap');
  if (state.layers.some((l) => l.source === 'upload')) sources.add('User data');
  const run = state.analysisRuns[state.analysisRuns.length - 1];
  if (run) sources.add(run.result.meta?.synthetic ? 'Demo analysis engine' : 'Google Earth Engine');
  sources.add('OpenFreeMap basemap');

  return [
    { label: 'Prepared by', value: APP.org },
    { label: 'Date', value: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) },
    { label: 'Projection', value: 'WGS 84 / Web Mercator (EPSG:3857)' },
    { label: 'Centre', value: `${formatDMS(center[1], 'lat')}, ${formatDMS(center[0], 'lng')}` },
    { label: 'Page', value: `${paper.label} ${state.page.orientation} · ${state.page.dpi} dpi` },
    { label: 'Zoom level', value: zoom.toFixed(1) },
    { label: 'Sources', value: Array.from(sources).join(', ') },
  ];
}

/** Attribution line, including any synthetic-data warning. */
export function creditsText() {
  const parts = [ATTRIBUTION_TEXT];
  if (state.analysisRuns.some((r) => r.result.meta?.synthetic)) {
    parts.push('Analysis layers shown here are synthetic demonstration data, not a validated assessment.');
  }
  return parts.join(' ');
}

/**
 * Scale-bar geometry, computed once against the on-screen artboard so
 * the printed bar represents the same ground distance as the preview.
 * @param {number} availableScreenPx  usable width of the element on screen
 * @returns {{ label: string, fraction: number, metres: number }}
 */
export function scaleBarFor(availableScreenPx, mPerPx) {
  const usable = Math.max(24, availableScreenPx);
  const bar = niceScaleBar(usable * 0.92, mPerPx);
  return { label: bar.label, metres: bar.metres, fraction: Math.min(1, bar.px / usable) };
}

/** Metres per screen pixel at the current camera. */
export function currentMetresPerPixel() {
  const { center, zoom } = state.mapView;
  return metresPerPixel(center[1], zoom);
}

/** Everything an element renderer might need, computed once per pass. */
export function buildRenderContext({ W, H, artWScreen, media }) {
  const u = (pt) => (pt ?? 0) * 0.001 * W;
  return {
    W, H, u, media,
    artWScreen: artWScreen ?? W,
    scale: W / (artWScreen ?? W),
    mPerPx: currentMetresPerPixel(),
    state,
    legendRows,
    statsRows,
    metadataRows,
    creditsText,
    scaleBarFor,
  };
}
