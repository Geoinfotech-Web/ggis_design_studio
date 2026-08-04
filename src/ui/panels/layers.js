/**
 * Layers pane — one list of everything drawn over the basemap, whatever
 * it came from. Selecting a layer opens its styling in the right panel.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, set, subscribe } from '../../core/store.js';
import { toggleLayer, removeLayer, reorderLayer } from '../../layers/registry.js';
import { flyToBounds } from '../../core/map.js';
import { boundsFromBbox, formatNumber } from '../../core/geo.js';
import { renderElements } from '../artboard.js';
import { setTool } from '../tool.js';
import { head, section, row, empty, miniBtn, button } from '../controls.js';

let pane;

const SOURCE_LABEL = {
  osm: 'OpenStreetMap',
  upload: 'Your file',
  boundary: 'Study area',
  analysis: 'Analysis',
  sample: 'Sample data',
};

function swatchColor(layer) {
  if (layer.type === 'raster') return '#64748b';
  const fill = layer.style?.fill;
  if (typeof fill === 'string') return fill;
  return layer.legend?.[0]?.color ?? '#0369a1';
}

function layerRow(layer) {
  const actions = [
    miniBtn(layer.visible ? '👁' : '◌', layer.visible ? 'Hide' : 'Show', () => {
      toggleLayer(layer.id);
      renderElements();
    }),
    miniBtn('▲', 'Move up', () => reorderLayer(layer.id, 1)),
    miniBtn('▼', 'Move down', () => reorderLayer(layer.id, -1)),
    miniBtn('⌖', 'Zoom to this layer', () => layer.bbox && flyToBounds(boundsFromBbox(layer.bbox))),
    miniBtn('✕', 'Remove', () => { removeLayer(layer.id); renderElements(); }),
  ];

  const count = layer.meta?.count;
  const sub = [
    SOURCE_LABEL[layer.source] ?? layer.source,
    Number.isFinite(count) ? `${formatNumber(count, 0)} features` : null,
    layer.visible ? null : 'hidden',
  ].filter(Boolean).join(' · ');

  return row({
    swatch: swatchColor(layer),
    title: layer.name,
    sub,
    active: layer.id === state.selectedLayerId,
    onClick: () => set({ selectedLayerId: layer.id, selectedElementId: null }, { history: false }),
    actions,
  });
}

export function render() {
  pane = pane ?? $('#pane-layers');
  if (!pane) return;

  // Top of the list = top of the map.
  const list = [...state.layers].reverse();

  fill(pane, [
    head('Layers', 'Draw order, visibility and styling. The topmost row draws last.'),
    list.length
      ? el('div', { style: { padding: '10px 14px' } }, list.map(layerRow))
      : el('div.panel-section', {}, [
          empty('Nothing on the map yet.<br />Add open data, upload a file, or run an analysis.'),
          button('Browse open data', () => setTool('data'), 'soft', { style: { width: '100%', marginTop: '10px' } }),
        ]),
    list.length ? section('', el('p', {
      style: { margin: 0, fontSize: '10.5px', lineHeight: '1.5', color: '#94a3b8' },
      text: 'Click a layer to change its colours, line weight and labels in the right-hand panel.',
    })) : null,
  ]);
}

export function initLayersPane() {
  pane = $('#pane-layers');
  render();
  subscribe(['layers', 'selectedLayerId'], () => { if (state.activeTool === 'layers') render(); });
}

export { render as renderLayersPane };
