/**
 * Elements pane — add and manage the furniture on the page.
 *
 * "Smart" elements (legend, key figures, map information, credits, scale)
 * read the live document, so they stay correct as data and analysis change.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, subscribe, touch, checkpoint } from '../../core/store.js';
import { ELEMENT_TYPES, ELEMENT_ORDER, createElement, elementLabel } from '../../layout/elements.js';
import { addElement, removeElement, reorderElement, duplicateElement, selectElement, renderElements } from '../artboard.js';
import { head, section, row, empty, miniBtn } from '../controls.js';

let pane;

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

function elementRow(elm) {
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
    miniBtn('✕', 'Delete', () => { removeElement(elm.id); renderElements(); }),
  ];

  return row({
    icon: ELEMENT_TYPES[elm.type]?.icon ?? '·',
    title: elm.text ? String(elm.text).slice(0, 32) : elementLabel(elm),
    sub: `${elementLabel(elm)}${elm.hidden ? ' · hidden' : ''}${elm.locked ? ' · locked' : ''}`,
    active: elm.id === state.selectedElementId,
    onClick: () => selectElement(elm.id),
    actions,
  });
}

export function render() {
  pane = pane ?? $('#pane-elements');
  if (!pane) return;

  // Topmost element first, matching what you see on the page.
  const list = [...state.elements].reverse();

  fill(pane, [
    head('Elements', 'Everything on the page is a movable element. Drag on the canvas, fine-tune on the right.'),
    section('Add to page', addGrid()),
    section('On this page', list.length
      ? el('div', {}, list.map(elementRow))
      : empty('No elements yet. Add one above.')),
  ]);
}

export function initElementsPane() {
  pane = $('#pane-elements');
  render();
  subscribe(['elements', 'selectedElementId'], () => { if (state.activeTool === 'elements') render(); });
}

export { render as renderElementsPane };
