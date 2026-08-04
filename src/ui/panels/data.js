/**
 * Data pane — open datasets and your own files.
 *
 * Everything here is scoped to the study area's bounding box, which keeps
 * Overpass queries polite and downloads small enough to draw smoothly.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, subscribe } from '../../core/store.js';
import { notify } from '../../core/toast.js';
import { OSM_GROUPS, datasetsInGroup } from '../../data/osm-catalog.js';
import { fetchDataset, checkSize } from '../../data/overpass.js';
import { parseGeoFile, ACCEPTED } from '../../data/upload.js';
import { addVectorLayer, removeLayer, replaceBySlug } from '../../layers/registry.js';
import { featureCount, formatNumber, bboxOf, boundsFromBbox } from '../../core/geo.js';
import { flyToBounds } from '../../core/map.js';
import { renderElements, hint } from '../artboard.js';
import { setTool } from '../tool.js';
import { head, section, group, row, empty, button, stack, miniBtn } from '../controls.js';

let pane;
const inflight = new Set();

const layerForSlug = (slug) => state.layers.find((l) => l.meta?.slug === slug) ?? null;

/* ------------------------------------------------------------------ */
async function toggleDataset(dataset) {
  const existing = layerForSlug(dataset.slug);
  if (existing) {
    removeLayer(existing.id);
    render();
    return;
  }

  const area = state.studyArea;
  if (!area) {
    notify.warn('Load a study area first — open data is fetched for that boundary.');
    setTool('area');
    return;
  }
  if (inflight.has(dataset.slug)) return;

  const size = checkSize(dataset, area.bbox);
  if (!size.ok) {
    notify.warn(size.reason, { duration: 9000 });
    return;
  }

  inflight.add(dataset.slug);
  render();
  const status = notify.busy(`Fetching <b>${dataset.name}</b>…`);

  try {
    const geojson = await fetchDataset(dataset, area.bbox, {
      onProgress: (msg) => status.update(`${msg}<br /><b>${dataset.name}</b>`),
    });
    const count = featureCount(geojson);
    if (!count) {
      status.update(`OpenStreetMap has no <b>${dataset.name}</b> mapped in this area yet.`, { tone: 'warn', duration: 6000 });
      return;
    }

    replaceBySlug(dataset.slug, {
      name: dataset.name,
      source: 'osm',
      geojson,
      kind: dataset.kind,
      color: dataset.color,
      style: { labelField: dataset.labelField ?? '' },
      legend: [{ label: dataset.name, color: dataset.color, swatch: dataset.kind }],
      description: dataset.hint,
    });
    renderElements();
    status.update(`<b>${dataset.name}</b> · ${formatNumber(count, 0)} features added.`, { tone: 'ok', duration: 4000 });
  } catch (err) {
    if (err.name === 'AbortError') status.close();
    else status.update(`Could not fetch ${dataset.name}. ${err.message}`, { tone: 'error', duration: 8000 });
  } finally {
    inflight.delete(dataset.slug);
    render();
  }
}

/* ------------------------------------------------------------------ */
async function handleFiles(files) {
  for (const file of files) {
    const status = notify.busy(`Reading <b>${file.name}</b>…`);
    try {
      const { geojson, name, format } = await parseGeoFile(file);
      const count = featureCount(geojson);
      if (!count) throw new Error('That file contained no features.');
      const layer = addVectorLayer({
        name,
        source: 'upload',
        geojson,
        color: '#7c3aed',
        description: `${format} · ${formatNumber(count, 0)} features`,
      });
      renderElements();
      const bbox = bboxOf(geojson);
      if (bbox) flyToBounds(boundsFromBbox(bbox));
      status.update(`<b>${name}</b> added — ${formatNumber(count, 0)} features from ${format}.`, { tone: 'ok', duration: 4500 });
      hint(`Open <b>Layers</b> to restyle “${layer.name}”.`);
    } catch (err) {
      status.update(err.message ?? 'Could not read that file.', { tone: 'error', duration: 8000 });
    }
  }
  render();
}

function dropZone() {
  const input = el('input', { type: 'file', accept: ACCEPTED, multiple: true, style: { display: 'none' } });
  input.addEventListener('change', () => { handleFiles(Array.from(input.files ?? [])); input.value = ''; });

  const zone = el('div', {
    style: {
      border: '1px dashed #cbd5e1', borderRadius: '12px', padding: '16px 12px',
      textAlign: 'center', cursor: 'pointer', transition: 'all .15s', background: '#f8fafc',
    },
  }, [
    el('div', { text: '⇪', style: { fontSize: '20px', color: '#94a3b8' } }),
    el('div', { text: 'Drop a file or click to browse', style: { fontSize: '12px', fontWeight: '600', marginTop: '4px' } }),
    el('div', { text: 'GeoJSON · KML · KMZ · GPX · CSV · zipped Shapefile', style: { fontSize: '10px', color: '#94a3b8', marginTop: '3px' } }),
    input,
  ]);

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = '#38bdf8'; zone.style.background = '#f0f9ff'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = '#cbd5e1'; zone.style.background = '#f8fafc'; });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.style.borderColor = '#cbd5e1';
    zone.style.background = '#f8fafc';
    handleFiles(Array.from(e.dataTransfer?.files ?? []));
  });
  return zone;
}

/* ------------------------------------------------------------------ */
function datasetRow(dataset) {
  const added = Boolean(layerForSlug(dataset.slug));
  const loading = inflight.has(dataset.slug);
  return row({
    icon: loading ? el('span.spinner.spinner--ink') : dataset.icon,
    title: dataset.name,
    sub: loading ? 'Fetching…' : dataset.hint,
    active: added,
    onClick: () => toggleDataset(dataset),
    actions: added ? [miniBtn('✕', 'Remove this layer', () => toggleDataset(dataset))] : [],
  });
}

export function render() {
  pane = pane ?? $('#pane-data');
  if (!pane) return;

  const area = state.studyArea;
  const groups = OSM_GROUPS.map((g, i) =>
    group(g.label, datasetsInGroup(g.id).map(datasetRow), i === 0));

  fill(pane, [
    head('Data', area
      ? `Open data for ${area.name}. Click to add, click again to remove.`
      : 'Add open map data, or bring your own file.'),
    area ? null : el('div.panel-section', {}, [
      empty('Open data is fetched for a study area.<br />Pick one first.'),
      button('Choose a study area', () => setTool('area'), 'soft', { style: { width: '100%', marginTop: '10px' } }),
    ]),
    ...groups,
    section('Your own data', stack([
      dropZone(),
      el('p', {
        style: { margin: 0, fontSize: '10.5px', color: '#94a3b8', lineHeight: '1.45' },
        text: 'Files are read in the browser and never uploaded anywhere.',
      }),
    ])),
    el('div.panel-section', {}, [
      el('p', {
        style: { margin: 0, fontSize: '10.5px', lineHeight: '1.5', color: '#94a3b8' },
        html: 'Data comes from the public Overpass API, a shared community service. Large areas and dense datasets (all streets, every building) are capped — zoom into a smaller boundary if a fetch is refused.',
      }),
    ]),
  ]);
}

export function initDataPane() {
  pane = $('#pane-data');
  render();
  subscribe(['layers', 'studyArea'], () => { if (state.activeTool === 'data') render(); });
}

export { render as renderDataPane };
