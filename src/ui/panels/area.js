/**
 * Study area pane — "where am I mapping?".
 *
 * The boundary that comes back from Nominatim is the real administrative
 * outline, and it becomes both a drawn layer and the clipping region every
 * analysis job runs inside.
 *
 * A map can be about more than one place. Adding a second area does not
 * replace the first: both outlines stay on the map, data is fetched for each
 * of them and merged, and every figure the page prints covers the whole set.
 * The list is owned by data/study-areas.js — this panel only edits it.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, subscribe } from '../../core/store.js';
import { notify } from '../../core/toast.js';
import {
  ADMIN_LEVELS, COUNTRIES, NIGERIA_STATES, NIGERIA_ZONES, adminLevelsFor, zoneById,
} from '../../core/constants.js';
import { lookupBoundary } from '../../data/boundaries.js';
import { fetchAdminChildren, buildZoneArea } from '../../data/admin.js';
import {
  addStudyArea, removeStudyArea, clearStudyAreas, studyAreas, areaKey,
} from '../../data/study-areas.js';
import { flyToBounds } from '../../core/map.js';
import { boundsFromBbox, formatArea, areaKm2, bboxOf, centroidOf } from '../../core/geo.js';
import { parseGeoFile } from '../../data/upload.js';
import { clipAreaToLand } from '../../data/land.js';
import { worldArea, listWorld } from '../../data/world.js';
import { placeSearch } from '../place-search.js';
import { syncAutoText } from '../../templates/apply.js';
import { renderElements, hint } from '../artboard.js';
import { head, section, labelled, select, button, stack, empty, miniBtn, seg } from '../controls.js';
import { setTool } from '../tool.js';
import { uiIcon } from '../ui-icons.js';

let pane;
let form = { level: 'state', country: 'ng', name: 'Rivers', zone: 'ss', parentState: 'Rivers', parentWorldId: null, lga: '' };
let busy = false;
// Where the boundary comes from: the open administrative boundaries, or a
// file of the user's own.
let source = 'open';

/**
 * The LGAs of one state, as fetched from OpenStreetMap.
 *
 * Kept per state rather than as one current list, so flicking between two
 * states does not refetch either. Only the names and outlines are held; the
 * fetch itself is cached a layer below, in this browser and in the shared
 * database, so even a first look at a state someone else has opened is instant.
 */
const lgaCache = new Map();     // state name → { units: [...], error?: string }
let lgaLoading = null;          // the state name currently being fetched

const countryName = () => COUNTRIES.find((c) => c.code === form.country)?.name ?? '';

/* ------------------------------------------------------------------ */
/* the LGAs of a state                                                 */
/* ------------------------------------------------------------------ */

/**
 * Load the list of LGAs for a state, so the picker can be a list rather than
 * a text box you have to already know the answer to type into.
 *
 * The state's own outline is looked up first because it is what decides
 * membership: Overpass can only be asked for a rectangle, and the rectangle
 * around Kaduna clips into six neighbours.
 */
async function loadLgaList(stateName) {
  if (!stateName || lgaCache.has(stateName) || lgaLoading === stateName) return;
  lgaLoading = stateName;
  render();
  const status = notify.busy(`Finding the LGAs of ${stateName}…`);

  try {
    const parent = await lookupBoundary({
      level: 'state', name: stateName, countryCode: form.country, countryName: countryName(),
    });
    const units = await fetchAdminChildren(parent, 'lga', {
      onProgress: (msg) => status.update(`${msg}<br />${stateName}`),
    });
    if (!units.length) throw new Error(`OpenStreetMap has no LGA boundaries mapped inside ${stateName} yet.`);

    lgaCache.set(stateName, { units, parent });
    if (!units.some((u) => u.name === form.lga)) form.lga = units[0].name;
    status.update(`<b>${units.length}</b> LGAs found in ${stateName}.`, { tone: 'ok', duration: 3500 });
  } catch (err) {
    lgaCache.set(stateName, { units: [], error: err.message });
    status.update(err.message ?? 'Could not list the LGAs.', { tone: 'error', duration: 7000 });
  } finally {
    lgaLoading = null;
    render();
  }
}

/**
 * The districts of a region from the world boundaries — instant, and the
 * route for every country other than Nigeria, whose LGAs still come from
 * OpenStreetMap so they line up with the basemap.
 */
async function loadWorldLgaList(stateName, parentId) {
  if (!stateName || !parentId || lgaLoading === stateName) return;
  lgaLoading = stateName;
  render();
  try {
    const rows = await listWorld({ parent: parentId });
    if (!rows.length) throw new Error(`No districts are recorded inside ${stateName}.`);
    const units = rows.map((r) => ({ name: r.name, areaKm2: r.areaKm2, worldId: r.id }));
    lgaCache.set(stateName, { units });
    if (!units.some((u) => u.name === form.lga)) form.lga = units[0].name;
  } catch (err) {
    lgaCache.set(stateName, { units: [], error: err.message });
  } finally {
    lgaLoading = null;
    render();
  }
}

/** Put the chosen LGA on the map, using the polygon already in hand. */
async function loadLga({ replace = false } = {}) {
  const entry = lgaCache.get(form.parentState);
  const unit = entry?.units.find((u) => u.name === form.lga);
  if (!unit) {
    notify.warn('Pick a state, then choose an LGA from the list.');
    return;
  }
  // A district from the world list is one row away on the cache server.
  if (unit.worldId) return loadWorldUnit(unit.worldId, { replace });
  // No lookup needed — the outline came back with the list, which is why the
  // list is worth fetching whole rather than one name at a time. A coastal
  // LGA's outline can run out to sea, so it is trimmed to the coast first.
  finish(await clipAreaToLand(unit), { replace });
}

/* ------------------------------------------------------------------ */
/* geopolitical zones                                                  */
/* ------------------------------------------------------------------ */
async function loadZone({ replace = false } = {}) {
  if (busy) return;
  busy = true;
  render();
  const zone = zoneById(form.zone);
  const status = notify.busy(`Assembling ${zone?.name ?? 'the zone'}…`);

  try {
    const { area, missing } = await buildZoneArea(form.zone, {
      onProgress: (msg) => status.update(msg),
    });
    const { added, reason } = addStudyArea(area, { replace });
    if (!added) {
      status.update(reason, { tone: 'warn', duration: 5000 });
      return;
    }

    syncAutoText();
    renderElements();
    flyToBounds(boundsFromBbox(state.studyArea.bbox));

    const note = missing.length
      ? ` ${missing.length} state${missing.length === 1 ? '' : 's'} could not be loaded (${missing.join(', ')}), so the figures cover the rest.`
      : '';
    status.update(
      `<b>${area.name}</b> — ${area.parts.length} states, ${formatArea(area.areaKm2)}.${note}`,
      { tone: missing.length ? 'warn' : 'ok', duration: missing.length ? 9000 : 5000 },
    );
    hint('Data is fetched for each state in the zone separately, then merged — so a zone works exactly like any other study area.');
  } catch (err) {
    status.update(err.message ?? 'Could not assemble that zone.', { tone: 'error', duration: 7000 });
  } finally {
    busy = false;
    render();
  }
}

/* ------------------------------------------------------------------ */
/** Everything that happens once an area object exists, whatever found it. */
function finish(area, { replace = false } = {}) {
  const { added, reason } = addStudyArea(area, { replace });
  if (!added) {
    notify.warn(reason);
    return false;
  }
  syncAutoText();
  renderElements();
  flyToBounds(boundsFromBbox(state.studyArea.bbox));

  const n = studyAreas().length;
  notify.ok(n > 1
    ? `<b>${area.name}</b> added — ${n} study areas, ${formatArea(state.studyArea.areaKm2)} in total.`
    : `<b>${area.name}</b> loaded — ${formatArea(area.areaKm2)}`, { duration: 4200 });
  render();
  return true;
}

/** Put one place from the world boundaries on the map. */
async function loadWorldUnit(id, { replace = false } = {}) {
  if (busy) return;
  busy = true;
  render();
  const status = notify.busy('Loading the boundary…');
  try {
    const area = await worldArea(id);
    status.close();
    busy = false;
    finish(area, { replace });
  } catch (err) {
    status.update(err.message ?? 'Could not load that boundary.', { tone: 'error', duration: 7000 });
  } finally {
    busy = false;
    render();
  }
}

/** A suggestion from a search box: a world unit, or an OpenStreetMap place by its full name. */
function pickPlace(choice, { replace = false } = {}) {
  if (choice.kind === 'world') return loadWorldUnit(choice.id, { replace });
  form.name = choice.label;
  const level = form.level;
  form.level = 'custom';
  return loadBoundary({ replace }).finally(() => { form.level = level; render(); });
}

/**
 * Look a place up and put it on the map.
 * @param {{replace?: boolean}} [opts]  replace:true swaps out everything
 *        already there — what "map somewhere else" means, as opposed to
 *        "map here as well".
 */
async function loadBoundary({ replace = false } = {}) {
  if (busy) return;
  // Anywhere in the world has no level picker: whatever was typed is a place.
  const anywhere = form.country === '';
  // Zones are assembled from several lookups and LGAs are already in hand, so
  // each has its own path; only the plain single-name lookup runs below.
  if (!anywhere && form.level === 'zone') return loadZone({ replace });
  if (!anywhere && form.level === 'lga') return loadLga({ replace });

  busy = true;
  render();
  const status = notify.busy('Looking up the boundary…');

  try {
    const area = await lookupBoundary({
      level: anywhere ? 'custom' : form.level,
      name: form.name,
      countryCode: form.country,
      countryName: countryName(),
    });

    const { added, reason } = addStudyArea(area, { replace });
    if (!added) {
      status.update(reason, { tone: 'warn', duration: 5000 });
      return;
    }

    syncAutoText();
    renderElements();
    // Zoom to everything, not just the new part — otherwise adding a second
    // area appears to throw the first one away.
    flyToBounds(boundsFromBbox(state.studyArea.bbox));

    const n = studyAreas().length;
    status.update(
      n > 1
        ? `<b>${area.name}</b> added — ${n} study areas, ${formatArea(state.studyArea.areaKm2)} in total.`
        : `<b>${area.name}</b> loaded — ${formatArea(area.areaKm2)}`,
      { tone: 'ok', duration: 4200 },
    );
    hint(n > 1
      ? 'Data now covers every area on this list. Each one is fetched separately, then merged.'
      : state.mapStarted
        ? 'Now open <b>Data</b> to add roads, rivers or buildings inside this area.'
        : 'Study area set. Press <b>Continue to Start map</b> when you are ready.');
  } catch (err) {
    status.update(err.message ?? 'Boundary lookup failed.', { tone: 'error', duration: 7000 });
  } finally {
    busy = false;
    render();
  }
}

function dropArea(key) {
  removeStudyArea(key);
  syncAutoText();
  renderElements();
  render();
}

function clearAll() {
  clearStudyAreas();
  syncAutoText();
  renderElements();
  render();
}

/* ------------------------------------------------------------------ */
/* the "what am I picking" controls, one set per level                 */
/* ------------------------------------------------------------------ */

/** Zone → the six states groupings, with what each one contains. */
function zoneControls() {
  const zone = zoneById(form.zone);
  return [
    labelled('Zone', select(
      NIGERIA_ZONES.map((z) => ({ value: z.id, label: `${z.name} — ${z.states.length} states` })),
      form.zone,
      (value) => { form.zone = value; render(); },
    ), zone ? zone.states.join(' · ') : ''),
    el('p', {
      style: { margin: 0, fontSize: '10.5px', color: 'var(--ink-faint)', lineHeight: '1.45' },
      html: 'A zone is not an administrative unit — OpenStreetMap has no boundary for one — so it is assembled from its states\' real outlines and dissolved into a single region.',
    }),
  ];
}

/**
 * LGA → pick the state, then pick from the LGAs actually inside it.
 *
 * This replaced a text box. Typing "Ikeja" worked; typing it for a state whose
 * 23 LGA names you do not have to hand did not, and neither did knowing
 * whether the one you wanted was spelled "Ogun Waterside" or "Ogun-Waterside".
 * The list is the state's real second tier, fetched from OpenStreetMap with
 * the outlines attached.
 */
function lgaControls() {
  const states = form.country === 'ng' ? NIGERIA_STATES : null;
  const entry = lgaCache.get(form.parentState);
  const loading = lgaLoading === form.parentState;

  const stateField = states
    ? select(states, form.parentState, (value) => {
        form.parentState = value;
        form.lga = '';
        render();
        loadLgaList(value);
      })
    : placeSearch({
        value: form.parentState,
        country: form.country,
        level: 'state',
        placeholder: 'e.g. Ashanti',
        onText: (value) => { form.parentState = value; form.parentWorldId = null; },
        onPick: (choice) => {
          if (choice.kind !== 'world') return;
          form.parentState = choice.name;
          form.parentWorldId = choice.id;
          form.lga = '';
          loadWorldLgaList(choice.name, choice.id);
        },
        onSubmit: (value) => { form.parentState = value; loadLgaList(value); },
      });

  const rows = [labelled(states ? 'State' : 'Region', stateField, states
    ? 'The LGA list is read from this state\'s boundaries.'
    : 'Type and pick the region; its districts are listed below.')];

  if (loading) {
    rows.push(el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', color: 'var(--ink-soft)' },
    }, [el('span.spinner.spinner--ink'), el('span', { text: `Reading the LGAs of ${form.parentState}…` })]));
  } else if (entry?.units?.length) {
    rows.push(labelled(states ? 'LGA' : 'District', select(
      entry.units.map((u) => ({ value: u.name, label: u.name })),
      form.lga || entry.units[0].name,
      (value) => { form.lga = value; render(); },
    ), (() => {
      const unit = entry.units.find((u) => u.name === (form.lga || entry.units[0].name));
      return `${entry.units.length} ${states ? 'LGAs' : 'districts'} in ${form.parentState}${unit ? ` · ${unit.name} is ${formatArea(unit.areaKm2)}` : ''}`;
    })()));
  } else if (entry?.error) {
    rows.push(el('p', {
      style: { margin: 0, fontSize: '10.5px', color: 'var(--ember)', lineHeight: '1.45' },
      text: entry.error,
    }));
    rows.push(button('Try again', () => { lgaCache.delete(form.parentState); listLgas(); }, 'ghost', {
      style: { width: '100%' },
    }));
  } else {
    rows.push(button(`List the ${states ? 'LGAs' : 'districts'} of ${form.parentState || 'this region'}`, listLgas, 'soft', {
      style: { width: '100%' },
    }));
  }

  return rows;
}

/** The district list for the chosen region, from whichever source has it. */
function listLgas() {
  if (form.parentWorldId && form.country !== 'ng') return loadWorldLgaList(form.parentState, form.parentWorldId);
  return loadLgaList(form.parentState);
}

/**
 * Anywhere in the world: one box, every country, region and district on
 * Earth, plus OpenStreetMap's towns and named places.
 */
function worldControls() {
  return [
    labelled('Search', placeSearch({
      value: form.name,
      country: '',
      osm: true,
      placeholder: 'Country, state, district, city or place',
      onText: (value) => { form.name = value; },
      onPick: (choice) => pickPlace(choice),
      onSubmit: () => loadBoundary(),
    }), 'Start typing — suggestions appear as you go. "Ikeja, Lagos" narrows by region or country.'),
  ];
}

/** Everything else: one name, typed or picked. */
function nameControl() {
  if (form.level === 'state' && form.country === 'ng') {
    return select(NIGERIA_STATES, form.name, (value) => { form.name = value; });
  }
  const placeholder = {
    country: 'Picked from the country list',
    city: 'e.g. Warri',
    state: 'e.g. Ashanti',
    custom: 'e.g. Yankari National Park',
  }[form.level] ?? 'Place name';

  // Regions come from the world boundaries; towns and named places from
  // OpenStreetMap as well, since they are not administrative units.
  return placeSearch({
    value: form.name,
    country: form.country,
    level: form.level === 'state' ? 'state' : '',
    osm: form.level !== 'state',
    placeholder,
    onText: (value) => { form.name = value; },
    onPick: (choice) => pickPlace(choice),
    onSubmit: () => loadBoundary(),
  });
}

/** One row of the list: what it is, how big, and how to get rid of it. */
function areaCard(area, removable) {
  const key = areaKey(area);
  return el('div.card', { style: { padding: '10px 11px' } }, [
    el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '6px' } }, [
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div', {
          text: area.name,
          style: { fontSize: '13.5px', fontWeight: '700', lineHeight: '1.2' },
        }),
        el('div', {
          text: area.displayName,
          style: {
            fontSize: '10.5px', color: 'var(--ink-faint)', margin: '3px 0 7px',
            lineHeight: '1.35', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
        }),
      ]),
      removable ? miniBtn(uiIcon('trash'), `Remove ${area.name}`, () => dropArea(key), { danger: true }) : null,
    ]),
    el('div', {
      style: { display: 'flex', gap: '12px', fontSize: '11.5px', color: 'var(--ink-soft)', marginBottom: '8px' },
    }, [
      el('span', { html: `<b>${formatArea(area.areaKm2)}</b> approx.` }),
      el('span', { text: ADMIN_LEVELS.find((l) => l.id === area.level)?.label ?? area.level }),
    ]),
    button('Zoom to', () => flyToBounds(boundsFromBbox(area.bbox)), 'soft', { style: { width: '100%' } }),
  ]);
}

/** The whole list, with its total — the figure the page itself will print. */
function areaList() {
  const areas = studyAreas();
  if (!areas.length) {
    return empty('No study area yet.<br />Pick a level and a name, then <b>Load boundary</b>.');
  }

  const many = areas.length > 1;
  return stack([
    ...areas.map((a) => areaCard(a, many)),
    many ? el('div', {
      style: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        gap: '8px', fontSize: '11.5px', color: 'var(--ink-soft)', padding: '2px 2px 0',
      },
    }, [
      el('span', { html: `<b>${areas.length}</b> areas` }),
      // Measured from the merged outlines, so two areas that overlap are not
      // counted twice here or on the printed map.
      el('span', { html: `<b>${formatArea(state.studyArea?.areaKm2 ?? 0)}</b> together` }),
    ]) : null,
    many ? button('Remove all', clearAll, 'ghost', { style: { width: '100%' } }) : null,
  ], '8px');
}

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* a boundary of your own                                              */
/* ------------------------------------------------------------------ */
const BOUNDARY_FILES = '.geojson,.json,.kml,.kmz,.gpx,.zip';

/**
 * Turn an uploaded file into a study area. Only its polygons are used: a
 * study area is a region, so points and lines in the same file are ignored
 * rather than guessed at.
 */
async function loadBoundaryFile(file, { replace = false } = {}) {
  if (!file || busy) return;
  busy = true;
  render();
  const status = notify.busy(`Reading <b>${file.name}</b>…`);
  try {
    const { geojson, name, format } = await parseGeoFile(file);
    const polygons = (geojson.features ?? []).filter((f) =>
      f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
    if (!polygons.length) {
      throw new Error(`${file.name} has no polygons. A study area needs an outline — a boundary drawn as an area, not points or lines.`);
    }
    const shape = { type: 'FeatureCollection', features: polygons };
    const area = {
      name,
      displayName: `${name} (uploaded ${format})`,
      level: 'custom',
      geojson: shape,
      bbox: bboxOf(shape),
      areaKm2: areaKm2(shape),
      center: centroidOf(shape),
      countryCode: '',
      osmType: 'upload',
      osmId: null,
    };
    status.close();
    finish(area, { replace });
  } catch (err) {
    status.update(err.message ?? 'That file could not be read.', { tone: 'error', duration: 8000 });
  } finally {
    busy = false;
    render();
  }
}

function uploadControls(has) {
  const input = el('input', { type: 'file', accept: BOUNDARY_FILES, style: { display: 'none' }, 'aria-label': 'Boundary file' });
  let replaceNext = false;
  input.addEventListener('change', () => { loadBoundaryFile(input.files?.[0], { replace: replaceNext }); input.value = ''; });
  const pick = (replace) => { replaceNext = replace; input.click(); };

  const zone = el('button.upload-zone', { type: 'button', disabled: busy ? true : null }, [
    el('strong', { text: busy ? 'Reading…' : has ? 'Add a boundary file' : 'Choose a boundary file' }),
    el('span', { text: 'Zipped Shapefile, GeoJSON, KML, KMZ or GPX. It is read here in your browser and saved only with your project.' }),
  ]);
  zone.addEventListener('click', () => pick(false));
  zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('is-over');
    loadBoundaryFile(event.dataTransfer?.files?.[0]);
  });

  return [
    input,
    zone,
    has ? button('Replace with a file instead', () => pick(true), 'ghost', { style: { width: '100%' }, disabled: busy ? true : null }) : null,
  ];
}

export function render() {
  pane = pane ?? $('#pane-area');
  if (!pane) return;

  const has = studyAreas().length > 0;
  const levels = adminLevelsFor(form.country);
  const anywhere = form.country === '';
  const countryField = () => labelled('Country', select(
    COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
    form.country,
    (value) => {
      form.country = value;
      form.parentWorldId = null;
      // Nigerian names make no sense as defaults anywhere else.
      if (value !== 'ng' && NIGERIA_STATES.includes(form.name)) form.name = '';
      if (value !== 'ng' && NIGERIA_STATES.includes(form.parentState)) form.parentState = '';
      if (value === 'ng' && !form.parentState) form.parentState = 'Rivers';
      if (value === 'ng' && form.level === 'state' && !NIGERIA_STATES.includes(form.name)) form.name = 'Rivers';
      // Zones are Nigeria's; leaving the country has to leave the level too.
      if (!adminLevelsFor(value).some((l) => l.id === form.level)) form.level = 'state';
      render();
    },
  ));

  // Zones and LGAs are not one lookup, so the button says what it will do.
  const verb = has ? 'Add' : 'Load';
  const label = busy || lgaLoading
    ? 'Working…'
    : anywhere ? (has ? 'Add this place' : 'Search and load')
    : form.level === 'zone' ? `${verb} this zone`
      : form.level === 'lga' ? `${verb} this LGA`
        : has ? 'Add this area' : 'Load boundary';

  const ready = anywhere || form.level !== 'lga' || Boolean(lgaCache.get(form.parentState)?.units?.length);
  const loadBtn = button(label, () => loadBoundary(), 'primary', {
    style: { width: '100%' },
    disabled: busy || lgaLoading || !ready ? true : null,
  });

  fill(pane, [
    head('Study area', state.mapStarted
      ? 'The place your map is about. Everything else works inside it.'
      : 'Step 1 — the place your map is about. The other tools open once it is set.'),
    section('', [seg(
      [{ value: 'open', label: 'Open boundaries' }, { value: 'upload', label: 'Upload my own' }],
      source,
      (value) => { source = value; render(); },
    )]),
    source === 'upload' ? section('Your own boundary', stack(uploadControls(has))) : null,
    source === 'upload' ? null : section('Find a place', stack(anywhere ? [
      countryField(),
      ...worldControls(),
      loadBtn,
      has ? el('p', {
        style: { margin: 0, fontSize: '10.5px', color: 'var(--ink-faint)', lineHeight: '1.45' },
        text: 'Added alongside the areas below. Data and every printed figure cover all of them.',
      }) : null,
    ] : [
      labelled('Level', select(
        levels.map((l) => ({ value: l.id, label: l.label })),
        form.level,
        (value) => {
          form.level = value;
          if (value === 'country') form.name = '';
          render();
          // The LGA picker is useless empty, so it fills itself the moment it
          // is asked for rather than waiting for a second click.
          if (value === 'lga') loadLgaList(form.parentState);
        },
      ), levels.find((l) => l.id === form.level)?.hint),
      countryField(),
      ...(form.level === 'zone' ? zoneControls()
        : form.level === 'lga' ? lgaControls()
          : form.level === 'country' ? []
            : [labelled('Name', nameControl())]),
      loadBtn,
      // Only worth offering once there is something to add to, and worth
      // saying plainly then: the button above no longer replaces anything.
      has ? el('p', {
        style: { margin: 0, fontSize: '10.5px', color: 'var(--ink-faint)', lineHeight: '1.45' },
        text: 'Added alongside the areas below. Data and every printed figure cover all of them.',
      }) : null,
      has ? button('Replace instead', () => loadBoundary({ replace: true }), 'ghost', {
        style: { width: '100%' },
        disabled: busy ? true : null,
      }) : null,
    ])),
    section(studyAreas().length > 1 ? 'Study areas' : 'Current study area', areaList()),
    // The way on. Shown until the map has been started; after that the rail
    // is open and this would only be noise.
    has && !state.mapStarted ? section('', [
      button('Continue to Start map', () => setTool('start'), 'primary', { style: { width: '100%' } }),
      el('p', {
        style: { margin: '7px 0 0', fontSize: '10.5px', color: 'var(--ink-faint)', lineHeight: '1.45', textAlign: 'center' },
        text: 'You can add more areas first, or come back and change them later.',
      }),
    ]) : null,
  ]);
}

/**
 * Load a place typed anywhere in the app (the landing search box, for
 * instance) and mirror it into this panel's form.
 *
 * This one replaces: searching from the home page is how a map starts, not
 * how a second area is added to one.
 */
export function loadPlace(query, country = '') {
  form = { level: 'custom', country, name: query };
  render();
  return loadBoundary({ replace: true });
}

export function initAreaPane() {
  pane = $('#pane-area');
  render();
  subscribe(['studyArea', 'studyAreas', 'mapStarted'], () => { if (state.activeTool === 'area') render(); });
}

export { render as renderAreaPane };
