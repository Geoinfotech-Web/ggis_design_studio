/**
 * Study area pane — "where am I mapping?".
 *
 * The boundary that comes back from Nominatim is the real administrative
 * outline, and it becomes both a drawn layer and the clipping region every
 * analysis job runs inside.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, set, subscribe } from '../../core/store.js';
import { notify } from '../../core/toast.js';
import { ADMIN_LEVELS, COUNTRIES, NIGERIA_STATES } from '../../core/constants.js';
import { lookupBoundary } from '../../data/boundaries.js';
import { addVectorLayer, findBySource, removeLayer } from '../../layers/registry.js';
import { flyToBounds } from '../../core/map.js';
import { boundsFromBbox, formatArea } from '../../core/geo.js';
import { syncAutoText } from '../../templates/apply.js';
import { renderElements, hint } from '../artboard.js';
import { head, section, labelled, select, textInput, button, stack, empty, inline } from '../controls.js';

let pane;
let form = { level: 'state', country: 'ng', name: 'Rivers' };
let busy = false;

const countryName = () => COUNTRIES.find((c) => c.code === form.country)?.name ?? '';

/* ------------------------------------------------------------------ */
async function loadBoundary() {
  if (busy) return;
  busy = true;
  render();
  const status = notify.busy('Looking up the boundary…');

  try {
    const area = await lookupBoundary({
      level: form.level,
      name: form.name,
      countryCode: form.country,
      countryName: form.level === 'country' ? countryName() : countryName(),
    });

    // One study-area outline at a time.
    findBySource('boundary').forEach((l) => removeLayer(l.id));

    addVectorLayer({
      name: `${area.name} boundary`,
      source: 'boundary',
      geojson: area.geojson,
      kind: 'polygon',
      color: '#0369a1',
      style: { fillOpacity: 0.07, strokeWidth: 2.2, stroke: '#0369a1' },
      legend: [{ label: `${area.name} boundary`, color: '#0369a1', swatch: 'polygon' }],
      description: area.displayName,
      meta: { slug: 'study-area', level: area.level },
    });

    set({ studyArea: area });
    syncAutoText();
    renderElements();
    flyToBounds(boundsFromBbox(area.bbox));

    status.update(`<b>${area.name}</b> loaded — ${formatArea(area.areaKm2)}`, { tone: 'ok', duration: 4200 });
    hint('Now open <b>Data</b> to add roads, rivers or buildings inside this area.');
  } catch (err) {
    status.update(err.message ?? 'Boundary lookup failed.', { tone: 'error', duration: 7000 });
  } finally {
    busy = false;
    render();
  }
}

function clearArea() {
  findBySource('boundary').forEach((l) => removeLayer(l.id));
  set({ studyArea: null });
  renderElements();
}

/* ------------------------------------------------------------------ */
function nameControl() {
  if (form.level === 'state' && form.country === 'ng') {
    return select(NIGERIA_STATES, form.name, (value) => { form.name = value; });
  }
  const placeholder = {
    country: 'Picked from the country list',
    lga: 'e.g. Port Harcourt',
    city: 'e.g. Warri',
    state: 'e.g. Ashanti',
    custom: 'e.g. Yankari National Park',
  }[form.level] ?? 'Place name';

  const input = textInput(form.name, (value) => { form.name = value; }, {
    placeholder,
    disabled: form.level === 'country' ? true : null,
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadBoundary(); });
  return input;
}

function currentAreaCard() {
  const area = state.studyArea;
  if (!area) {
    return empty('No study area yet.<br />Pick a level and a name, then <b>Load boundary</b>.');
  }
  return el('div.card', { style: { padding: '11px 12px' } }, [
    el('div', { text: area.name, style: { fontSize: '14px', fontWeight: '700', lineHeight: '1.2' } }),
    el('div', { text: area.displayName, style: { fontSize: '10.5px', color: '#94a3b8', margin: '3px 0 8px', lineHeight: '1.35' } }),
    el('div', {
      style: { display: 'flex', gap: '14px', fontSize: '11.5px', color: '#475569', marginBottom: '10px' },
    }, [
      el('span', { html: `<b>${formatArea(area.areaKm2)}</b> approx.` }),
      el('span', { text: ADMIN_LEVELS.find((l) => l.id === area.level)?.label ?? area.level }),
    ]),
    inline([
      button('Zoom to area', () => flyToBounds(boundsFromBbox(area.bbox)), 'soft'),
      button('Clear', clearArea, 'ghost'),
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
export function render() {
  pane = pane ?? $('#pane-area');
  if (!pane) return;

  const loadBtn = button(busy ? 'Loading…' : 'Load boundary', loadBoundary, 'primary', {
    style: { width: '100%' },
    disabled: busy ? true : null,
  });

  fill(pane, [
    head('Study area', 'The place your map is about. Everything else works inside it.'),
    section('Find a place', stack([
      labelled('Level', select(
        ADMIN_LEVELS.map((l) => ({ value: l.id, label: l.label })),
        form.level,
        (value) => { form.level = value; if (value === 'country') form.name = ''; render(); },
      ), ADMIN_LEVELS.find((l) => l.id === form.level)?.hint),
      labelled('Country', select(
        COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
        form.country,
        (value) => { form.country = value; render(); },
      )),
      form.level === 'country' ? null : labelled('Name', nameControl()),
      loadBtn,
    ])),
    section('Current study area', currentAreaCard()),
    el('div.panel-section', {}, [
      el('p', {
        style: { margin: 0, fontSize: '10.5px', lineHeight: '1.5', color: '#94a3b8' },
        html: 'Boundaries come live from OpenStreetMap Nominatim, which allows about one lookup per second. Results are cached for this session. Area figures are approximate — they are computed from the mapped outline, not from a survey.',
      }),
    ]),
  ]);
}

/**
 * Load a place typed anywhere in the app (the landing search box, for
 * instance) and mirror it into this panel's form.
 */
export function loadPlace(query, country = '') {
  form = { level: 'custom', country, name: query };
  render();
  return loadBoundary();
}

export function initAreaPane() {
  pane = $('#pane-area');
  render();
  subscribe(['studyArea'], () => { if (state.activeTool === 'area') render(); });
}

export { render as renderAreaPane };
