/**
 * Elements pane — add, manage and align the furniture on the page.
 *
 * "Smart" elements (legend, key figures, map information, credits, scale)
 * read the live document, so they stay correct as data and analysis change.
 *
 * Tick two or more elements and the align toolbar appears: the same
 * left/centre/right controls a design tool would give you, working either
 * against the page or against the ticked group.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, subscribe, touch, checkpoint } from '../../core/store.js';
import { notify } from '../../core/toast.js';
import { ELEMENT_TYPES, ELEMENT_ORDER, createElement, elementLabel } from '../../layout/elements.js';
import { alignElements, distributeElements, matchSize } from '../../layout/align.js';
import { addElement, removeElement, reorderElement, duplicateElement, selectElement, renderElements } from '../artboard.js';
import { head, section, row, empty, miniBtn, seg, button, stack, inline } from '../controls.js';

let pane;
let alignHost;

/** Elements ticked for a group operation. Deliberately local: this is a
 *  transient working set, not part of the document. */
const ticked = new Set();
let alignTo = 'page';
let margin = 4;

/** Redraw just the align box — ticking a checkbox must not rebuild the
 *  list underneath the pointer. */
function refreshAlign() {
  if (alignHost) fill(alignHost, ticked.size ? alignToolbar() : alignHelp());
}

/** Drop a new element roughly in the middle, nudged clear of what's there. */
function place(type) {
  const def = ELEMENT_TYPES[type];
  const taken = state.elements.filter((e) => e.type === type).length;
  const elm = createElement(type, {
    x: Math.min(80, def.defaults.x + taken * 2),
    y: Math.min(92, def.defaults.y + taken * 2),
  });
  addElement(elm);
  renderElements();
}

function addGrid() {
  const grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } });
  for (const type of ELEMENT_ORDER) {
    const def = ELEMENT_TYPES[type];
    const btn = el('button.row', {
      type: 'button',
      title: def.hint,
      style: { border: '1px solid var(--line)' },
    }, [
      el('span.row-ico', { text: def.icon }),
      el('span.row-main', {}, [el('span.row-title', { text: def.label, style: { display: 'block' } })]),
    ]);
    btn.addEventListener('click', () => place(type));
    grid.append(btn);
  }
  return grid;
}

/* ------------------------------------------------------------------ */
/* align toolbar                                                       */
/* ------------------------------------------------------------------ */
const alignHelp = () => el('p', {
  style: { margin: 0, fontSize: '11.5px', color: '#94a3b8', lineHeight: '1.5' },
  html: 'Tick the boxes below to line elements up — left, centre, right, or spread evenly. A single element can also be dropped onto any corner of the page from the <b>Arrange</b> section on the right.',
});

function alignToolbar() {
  const ids = [...ticked];
  const many = ids.length > 1;

  const act = (label, run, title) => {
    const btn = el('button.btn-ghost', {
      type: 'button', text: label, title: title ?? label,
      style: { padding: '5px 0', fontSize: '11px', flex: '1' },
    });
    btn.addEventListener('click', () => {
      if (run(ids)) renderElements();
    });
    return btn;
  };

  const alignAct = (mode, label) =>
    act(label, (list) => alignElements(list, mode, { relativeTo: alignTo, margin }), `Align ${label.toLowerCase()}`);

  return stack([
    el('div', {
      style: { fontSize: '11.5px', color: '#475569' },
      html: `<b>${ids.length}</b> element${ids.length === 1 ? '' : 's'} ticked`,
    }),
    seg(
      [{ value: 'page', label: 'To page' }, { value: 'selection', label: 'To each other' }],
      alignTo,
      (value) => { alignTo = value; refreshAlign(); },
    ),
    inline([alignAct('left', 'Left'), alignAct('centre', 'Centre'), alignAct('right', 'Right')], '4px'),
    inline([alignAct('top', 'Top'), alignAct('middle', 'Middle'), alignAct('bottom', 'Bottom')], '4px'),
    many ? inline([
      act('Spread across', (list) => {
        const n = distributeElements(list, 'x');
        if (!n) notify.info('Tick at least three elements to spread them out.');
        return n;
      }, 'Equal horizontal gaps'),
      act('Spread down', (list) => {
        const n = distributeElements(list, 'y');
        if (!n) notify.info('Tick at least three elements to spread them out.');
        return n;
      }, 'Equal vertical gaps'),
    ], '4px') : null,
    many ? inline([
      act('Same width', (list) => matchSize(list, 'x')),
      act('Same height', (list) => matchSize(list, 'y')),
    ], '4px') : null,
    alignTo === 'page'
      ? el('label', { style: { display: 'block' } }, [
          el('span.field-label', { text: `Page margin — ${margin}%` }),
          (() => {
            const input = el('input', { type: 'range', min: 0, max: 18, step: 0.5, value: margin });
            input.addEventListener('change', () => { margin = Number(input.value); refreshAlign(); });
            return input;
          })(),
        ])
      : null,
    inline([
      button('Tick all', () => { state.elements.forEach((e) => ticked.add(e.id)); render(); }, 'ghost'),
      button('Clear', () => { ticked.clear(); render(); }, 'ghost'),
    ], '5px'),
  ], '7px');
}

/* ------------------------------------------------------------------ */
function elementRow(elm) {
  const tick = el('input', {
    type: 'checkbox',
    checked: ticked.has(elm.id),
    title: 'Tick for aligning',
    style: { accentColor: '#0369a1', width: '14px', height: '14px', flex: 'none', cursor: 'pointer' },
  });
  tick.addEventListener('click', (event) => event.stopPropagation());
  tick.addEventListener('change', () => {
    if (tick.checked) ticked.add(elm.id); else ticked.delete(elm.id);
    refreshAlign();
  });

  const actions = [
    miniBtn(elm.hidden ? '◌' : '👁', elm.hidden ? 'Show' : 'Hide', () => {
      checkpoint();
      elm.hidden = !elm.hidden;
      touch('elements');
      renderElements();
    }),
    miniBtn(elm.locked ? '🔒' : '🔓', elm.locked ? 'Unlock' : 'Lock position', () => {
      checkpoint();
      elm.locked = !elm.locked;
      touch('elements');
      renderElements();
    }),
    miniBtn('⧉', 'Duplicate', () => { duplicateElement(elm.id); renderElements(); }),
    miniBtn('▲', 'Bring forward', () => { reorderElement(elm.id, 1); renderElements(); }),
    miniBtn('▼', 'Send backward', () => { reorderElement(elm.id, -1); renderElements(); }),
    miniBtn('✕', 'Delete', () => { ticked.delete(elm.id); removeElement(elm.id); renderElements(); }),
  ];

  const node = row({
    icon: ELEMENT_TYPES[elm.type]?.icon ?? '·',
    title: elm.text ? String(elm.text).slice(0, 32) : elementLabel(elm),
    sub: `${elementLabel(elm)}${elm.hidden ? ' · hidden' : ''}${elm.locked ? ' · locked' : ''}`,
    active: elm.id === state.selectedElementId,
    onClick: () => selectElement(elm.id),
    actions,
  });
  node.prepend(tick);
  return node;
}

export function render() {
  pane = pane ?? $('#pane-elements');
  if (!pane) return;

  // Drop ticks for elements that no longer exist.
  for (const id of [...ticked]) {
    if (!state.elements.some((e) => e.id === id)) ticked.delete(id);
  }

  // Topmost element first, matching what you see on the page.
  const list = [...state.elements].reverse();
  alignHost = el('div');

  fill(pane, [
    head('Elements', 'Everything on the page is a movable element. Drag on the canvas, fine-tune on the right.'),
    section('Add to page', addGrid()),
    section('Align', alignHost),
    section('On this page', list.length
      ? el('div', {}, list.map(elementRow))
      : empty('No elements yet. Add one above.')),
  ]);

  refreshAlign();
}

export function initElementsPane() {
  pane = $('#pane-elements');
  render();
  subscribe(['elements', 'selectedElementId'], () => { if (state.activeTool === 'elements') render(); });
}

export { render as renderElementsPane };
