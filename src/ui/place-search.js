/**
 * A place search box that suggests as you type.
 *
 * Suggestions come from two places. The world boundaries database
 * (data/world.js) answers first and instantly — every country, region and
 * district on Earth, each with its outline ready. When the search is open to
 * any kind of place, OpenStreetMap is asked as well (after a short pause in
 * typing, because Nominatim allows one request a second), so a park, a campus
 * or a town that is not an administrative unit can still be found.
 *
 * The box keeps its own state: the panel around it re-renders by replacing
 * its DOM, and a suggestion list that vanished on every keystroke would be no
 * use. Up/Down move through the list, Enter takes the highlighted (or first)
 * suggestion, Escape closes it.
 */

import { el } from '../core/dom.js';
import { searchWorld, placeLine } from '../data/world.js';
import { suggestPlaces } from '../data/boundaries.js';
import { formatArea } from '../core/geo.js';

// OpenStreetMap results worth offering as a study area: things with an
// outline. A shop, a house or a bus stop is a point, and would only fail.
const AREA_CLASSES = new Set(['boundary', 'place', 'landuse', 'leisure', 'natural', 'amenity', 'tourism', 'aeroway', 'military', 'waterway']);

const LEVEL_LABEL = { country: 'Country', state: 'Region', lga: 'District' };

/**
 * @param {object} opts
 * @param {string} [opts.value]        initial text
 * @param {string} [opts.country]      ISO alpha-2 to search within; '' for the whole world
 * @param {string} [opts.level]        'country' | 'state' | 'lga' — only that level; '' for any
 * @param {boolean} [opts.osm]         also suggest OpenStreetMap places (towns, parks…)
 * @param {string} [opts.placeholder]
 * @param {(text:string) => void} [opts.onText]       every keystroke
 * @param {(choice:object) => void} opts.onPick        {kind:'world', id, name, …} or {kind:'osm', label}
 * @param {(text:string) => void} [opts.onSubmit]     Enter with nothing to pick
 */
export function placeSearch(opts) {
  const {
    value = '', country = '', level = '', osm = false, placeholder = 'Search for a place', onText, onPick, onSubmit,
  } = opts;

  const input = el('input.field.place-search-input', {
    type: 'search', value, placeholder, autocomplete: 'off', spellcheck: 'false',
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-label': placeholder,
  });
  const list = el('div.place-suggest', { role: 'listbox', hidden: true });
  const root = el('div.place-search', {}, [input, list]);

  let items = [];          // what is listed, in order
  let active = -1;
  let worldTimer = 0;
  let osmTimer = 0;
  let worldAbort = null;
  let osmAbort = null;
  let osmItems = [];
  let worldItems = [];
  let searching = false;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };

  function pick(item) {
    if (!item) return;
    input.value = item.kind === 'world' ? item.name : item.label.split(',')[0];
    onText?.(input.value);
    close();
    onPick(item);
  }

  function draw() {
    items = [...worldItems, ...osmItems];
    list.replaceChildren();
    if (!input.value.trim() || document.activeElement !== input) { close(); return; }

    if (!items.length) {
      list.append(el('div.place-suggest-empty', { text: searching ? 'Searching…' : 'No match yet. Keep typing, or press Enter to search.' }));
    }
    items.forEach((item, i) => {
      const row = item.kind === 'world'
        ? el('button.place-suggest-row', { type: 'button', role: 'option' }, [
            el('span.place-suggest-text', {}, [
              el('strong', { text: item.name }),
              el('small', { text: [placeLine(item), item.areaKm2 ? formatArea(item.areaKm2) : ''].filter(Boolean).join(' · ') }),
            ]),
            el('span.place-suggest-tag', { text: LEVEL_LABEL[item.level] ?? item.level }),
          ])
        : el('button.place-suggest-row', { type: 'button', role: 'option' }, [
            el('span.place-suggest-text', {}, [
              el('strong', { text: item.label.split(',')[0] }),
              el('small', { text: item.label.split(',').slice(1).join(',').trim() }),
            ]),
            el('span.place-suggest-tag.is-osm', { text: item.type ? item.type.replace(/_/g, ' ') : 'Place' }),
          ]);
      if (i === worldItems.length && i > 0) list.append(el('div.place-suggest-head', { text: 'Other places · OpenStreetMap' }));
      row.classList.toggle('is-active', i === active);
      row.setAttribute('aria-selected', String(i === active));
      // mousedown, not click: a click would blur the input and close the list first.
      row.addEventListener('mousedown', (event) => { event.preventDefault(); pick(item); });
      list.append(row);
    });
    if (worldItems.length && !osmItems.length && !osm) {
      list.append(el('div.place-suggest-foot', { text: 'Boundaries © OpenStreetMap contributors, via Overture Maps' }));
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function query() {
    const text = input.value.trim();
    clearTimeout(worldTimer);
    clearTimeout(osmTimer);
    worldAbort?.abort();
    osmAbort?.abort();
    osmItems = [];
    if (text.length < 2) { worldItems = []; close(); return; }

    searching = true;
    worldTimer = setTimeout(async () => {
      worldAbort = new AbortController();
      try {
        const rows = await searchWorld(text, { country, level, limit: osm ? 6 : 10, signal: worldAbort.signal });
        if (input.value.trim() !== text) return;
        worldItems = rows.map((r) => ({ kind: 'world', ...r }));
        active = items.length ? Math.min(active, worldItems.length - 1) : -1;
        searching = osm && text.length >= 3;
        draw();
      } catch { /* aborted: a newer keystroke is on its way */ }
    }, 90);

    if (osm && text.length >= 3) {
      osmTimer = setTimeout(async () => {
        osmAbort = new AbortController();
        try {
          const rows = await suggestPlaces(text, country, osmAbort.signal);
          if (input.value.trim() !== text) return;
          // Administrative areas the world list already offers are not repeated.
          const seen = new Set(worldItems.map((w) => w.name.toLowerCase()));
          osmItems = rows
            .filter((r) => AREA_CLASSES.has(r.className) && r.type !== 'house')
            .filter((r) => !(r.className === 'boundary' && seen.has(r.label.split(',')[0].trim().toLowerCase())))
            .slice(0, 5)
            .map((r) => ({ kind: 'osm', ...r }));
        } catch { /* aborted, or Nominatim unreachable: the world list stands alone */ }
        searching = false;
        draw();
      }, 450);
    }
  }

  input.addEventListener('input', () => { onText?.(input.value); active = -1; query(); });
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) query(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!items.length) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + items.length) % items.length;
      draw();
      list.querySelectorAll('.place-suggest-row')[active]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const choice = items[active >= 0 ? active : 0];
      if (choice && !list.hidden) pick(choice);
      else { close(); onSubmit?.(input.value); }
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });

  return root;
}
