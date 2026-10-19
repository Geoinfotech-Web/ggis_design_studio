/**
 * Keyboard shortcuts — one table that both runs the keys and writes the
 * help sheet, so the sheet can never list a key that does something else.
 *
 * The map keys follow ArcGIS Pro where it has one (C to pan, +/− to zoom,
 * arrows to pan the view), and single letters are only read when nothing is
 * being typed and no modifier is held, so they never fight a text field or
 * the browser's own Ctrl shortcuts.
 *
 * Some keys are handled where their behaviour lives (undo in the header,
 * nudging in the artboard, Space-to-pan in pan mode). They appear here with
 * `run: null` so the sheet is complete without the key firing twice.
 */

import { el } from '../core/dom.js';
import { state } from '../core/store.js';

const IS_MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
export const MOD = IS_MAC ? '⌘' : 'Ctrl';

let actions = {};

/**
 * @typedef {object} Shortcut
 * @property {string[]} keys      as shown, e.g. ['Ctrl', 'S']
 * @property {string}   label
 * @property {(e: KeyboardEvent) => boolean} [match]
 * @property {(e: KeyboardEvent) => void} [run]   null: handled elsewhere
 */

const plain = (e) => !e.ctrlKey && !e.metaKey && !e.altKey;
const letter = (ch) => (e) => plain(e) && !e.shiftKey && e.key.toLowerCase() === ch;
const mod = (ch, shift = false) => (e) => (e.ctrlKey || e.metaKey) && !e.altKey && e.shiftKey === shift && e.key.toLowerCase() === ch;
const call = (name, ...args) => () => actions[name]?.(...args);

const PANELS = [
  ['area', 'Study area'], ['start', 'Start map'], ['data', 'Data'],
  ['elements', 'Elements'], ['layers', 'Layers'], ['projects', 'My projects'], ['ai', 'AI assistant'],
];

/** @type {{ title: string, items: Shortcut[] }[]} */
export const SHORTCUT_GROUPS = [
  {
    title: 'Map navigation',
    items: [
      { keys: ['C'], label: 'Pan mode on / off — drag the map through page elements', match: letter('c'), run: call('togglePan') },
      { keys: ['Space'], label: 'Hold to pan for a moment', run: null },
      { keys: ['F'], label: 'Fit the map to the study area', match: letter('f'), run: call('fitArea') },
      { keys: ['N'], label: 'North up — reset rotation and tilt', match: letter('n'), run: call('northUp') },
      { keys: ['+'], label: 'Zoom in', match: (e) => plain(e) && (e.key === '+' || e.key === '='), run: call('zoom', 1) },
      { keys: ['−'], label: 'Zoom out', match: (e) => plain(e) && (e.key === '-' || e.key === '_'), run: call('zoom', -1) },
      { keys: ['←', '↑', '→', '↓'], label: 'Pan the map (when nothing on the page is selected)', match: (e) => plain(e) && !e.shiftKey && e.key.startsWith('Arrow') && !state.selectedElementId, run: (e) => actions.panBy?.(e.key) },
      { keys: ['Shift', '←'], label: 'Rotate the map left (Shift + → rotates right)', match: (e) => plain(e) && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !state.selectedElementId, run: (e) => actions.rotate?.(e.key === 'ArrowLeft' ? -15 : 15) },
    ],
  },
  {
    title: 'Page layout',
    items: [
      { keys: ['L'], label: 'Lock / unlock the layout — when locked, scroll zooms and dragging moves the whole page, map and all', match: letter('l'), run: call('toggleLayoutLock') },
      { keys: ['+', '−'], label: 'While locked: zoom the page in / out', run: null },
      { keys: ['←', '↑', '→', '↓'], label: 'While locked: move around the page', run: null },
      { keys: ['0'], label: 'Fit the whole page in the window', match: (e) => plain(e) && !e.shiftKey && e.key === '0', run: call('fitPage') },
    ],
  },
  {
    title: 'Map tools',
    items: [
      { keys: ['B'], label: 'Basemap gallery', match: letter('b'), run: call('toggleBasemap') },
      { keys: ['M'], label: 'Map frame on / off — the map shows only inside it, paper outside', match: letter('m'), run: call('toggleMapFrame') },
      { keys: ['G'], label: 'Grid lines & coordinate labels on / off', match: letter('g'), run: call('toggleGrid') },
      { keys: ['V'], label: 'View tools menu', match: letter('v'), run: call('toggleView') },
      { keys: ['D'], label: 'Coordinates in decimal degrees / degrees-minutes-seconds', match: letter('d'), run: call('toggleCoordFormat') },
      { keys: ['T'], label: 'Map style panel — templates, basemap, page and look', match: letter('t'), run: call('panel', 'templates') },
    ],
  },
  {
    title: 'Panels',
    items: PANELS.map(([id, label], i) => ({
      keys: ['Alt', String(i + 1)],
      label,
      match: (e) => e.altKey && !e.ctrlKey && !e.metaKey && e.code === `Digit${i + 1}`,
      run: call('panel', id),
    })),
  },
  {
    title: 'Page elements',
    items: [
      { keys: ['←', '↑', '→', '↓'], label: 'Nudge the selected element (hold Shift for a bigger step)', run: null },
      { keys: ['Delete'], label: 'Remove the selected element', run: null },
      { keys: ['Alt'], label: 'Hold while dragging to ignore the snap guides', run: null },
      { keys: ['Double-click'], label: 'On a locator inset: pan (drag) and zoom (scroll) its map', run: null },
      { keys: ['Esc'], label: 'Deselect, leave pan mode, close a menu', run: null },
    ],
  },
  {
    title: 'Project',
    items: [
      { keys: [MOD, 'S'], label: 'Save to your projects', run: null },
      { keys: [MOD, 'Z'], label: 'Undo', run: null },
      { keys: [MOD, 'Y'], label: `Redo (also ${MOD} + Shift + Z)`, run: null },
      { keys: [MOD, 'E'], label: 'Export PDF', run: null },
      { keys: [MOD, 'Shift', 'E'], label: 'Export PNG', match: mod('e', true), run: call('exportPng') },
      { keys: ['?'], label: 'This list of shortcuts (also F1)', match: (e) => (!e.ctrlKey && !e.metaKey && e.key === '?') || e.key === 'F1', run: call('help') },
    ],
  },
];

/** The keys of the first shortcut that runs `name`, for tooltips. */
export const keysFor = (label) => {
  for (const group of SHORTCUT_GROUPS) {
    const hit = group.items.find((s) => s.label.startsWith(label));
    if (hit) return hit.keys;
  }
  return [];
};

export const kbd = (keys) => el('span.kbd-combo', {}, keys.map((k) => el('kbd', { text: k })));

const typing = (target) => target?.matches?.('input, textarea, select, [contenteditable], [contenteditable] *');

/** Wire the table to the window. `handlers` maps action names to functions. */
export function initShortcuts(handlers) {
  actions = handlers;
  window.addEventListener('keydown', (event) => {
    if (state.view !== 'studio' || event.repeat && !event.key.startsWith('Arrow') && event.key !== '+' && event.key !== '-' && event.key !== '=') return;
    if (typing(event.target)) return;
    if (document.querySelector('dialog[open]:not(.shortcut-sheet)')) return;
    for (const group of SHORTCUT_GROUPS) {
      for (const item of group.items) {
        if (!item.run || !item.match?.(event)) continue;
        event.preventDefault();
        item.run(event);
        return;
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* the help sheet                                                      */
/* ------------------------------------------------------------------ */
export function openShortcutHelp() {
  document.querySelector('dialog.shortcut-sheet')?.close();
  const close = el('button.shortcut-close', { type: 'button', text: '×', 'aria-label': 'Close' });
  const dialog = el('dialog.shortcut-sheet', { 'aria-label': 'Keyboard shortcuts' }, [
    el('header.shortcut-head', {}, [
      el('div', {}, [
        el('h2', { text: 'Keyboard shortcuts' }),
        el('p', { text: 'Single-letter keys work whenever you are not typing in a field.' }),
      ]),
      close,
    ]),
    el('div.shortcut-groups', {}, SHORTCUT_GROUPS.map((group) => el('section.shortcut-group', {}, [
      el('h3', { text: group.title }),
      el('dl', {}, group.items.flatMap((item) => [el('dt', {}, [kbd(item.keys)]), el('dd', { text: item.label })])),
    ]))),
  ]);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
