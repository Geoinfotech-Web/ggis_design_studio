/**
 * Small control builders shared by every panel.
 *
 * These exist so the panels read as a description of their content rather
 * than a wall of createElement calls, and so one class-name change here
 * restyles the whole studio.
 */

import { el } from '../core/dom.js';

export const head = (title, sub) =>
  el('div.panel-head', {}, [el('h2', { text: title }), sub ? el('p', { text: sub }) : null]);

export const section = (title, children, opts = {}) =>
  el('div.panel-section', {}, [
    title ? el('div.panel-title', { text: title, style: { marginBottom: '8px' } }) : null,
    ...[].concat(children).filter(Boolean),
  ].filter(Boolean));

export const empty = (text) => el('div.panel-empty', { html: text });

export const labelled = (text, control, hint) =>
  el('label.block', { style: { display: 'block', marginBottom: '9px' } }, [
    el('span.field-label', { text }),
    control,
    hint ? el('span', { text: hint, style: { display: 'block', marginTop: '3px', fontSize: '10px', color: '#94a3b8', lineHeight: '1.35' } }) : null,
  ]);

/** A <select> built from [{value,label}] or plain strings. */
export function select(options, value, onChange, props = {}) {
  const node = el('select.field', { ...props });
  for (const opt of options) {
    const o = typeof opt === 'string' ? { value: opt, label: opt } : opt;
    node.append(el('option', { value: o.value, text: o.label, selected: String(o.value) === String(value) }));
  }
  node.value = value ?? '';
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

export function textInput(value, onChange, props = {}) {
  const node = el('input.field', { type: 'text', value: value ?? '', ...props });
  node.addEventListener('input', () => onChange(node.value));
  return node;
}

export function textArea(value, onChange, rows = 3) {
  const node = el('textarea.field', { rows, style: { resize: 'vertical', lineHeight: '1.4' } });
  node.value = value ?? '';
  node.addEventListener('input', () => onChange(node.value));
  return node;
}

export function numberInput(value, onChange, props = {}) {
  const node = el('input.field', { type: 'number', value, ...props });
  node.addEventListener('change', () => onChange(Number(node.value)));
  return node;
}

/** Range slider with a live value read-out. */
export function slider(opts, onInput) {
  const { min = 0, max = 100, step = 1, value = 0, suffix = '' } = opts;
  const out = el('span', { text: `${value}${suffix}`, style: { fontSize: '11px', fontWeight: '700', color: '#0369a1', minWidth: '34px', textAlign: 'right' } });
  const input = el('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => {
    out.textContent = `${input.value}${suffix}`;
    onInput(Number(input.value));
  });
  return el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [input, out]);
}

/** Segmented control. `options` is [{value,label}]. */
export function seg(options, value, onChange) {
  const node = el('div.seg');
  for (const opt of options) {
    const btn = el('button.seg-btn', { type: 'button', text: opt.label, title: opt.title ?? opt.label });
    btn.classList.toggle('is-active', String(opt.value) === String(value));
    btn.addEventListener('click', () => {
      node.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      onChange(opt.value);
    });
    node.append(btn);
  }
  return node;
}

export function colorInput(value, onChange) {
  const node = el('input.color-input', { type: 'color', value: value ?? '#000000' });
  node.addEventListener('input', () => onChange(node.value));
  return node;
}

/** A label + control on one line — the inspector's workhorse. */
export const inspectorRow = (text, control) =>
  el('div.insp-row', {}, [el('span', { text }), control]);

/** Checkbox styled as a small switch row. */
export function checkRow(text, checked, onChange, sub) {
  const box = el('input', { type: 'checkbox', checked, style: { accentColor: '#0369a1', width: '14px', height: '14px', flex: 'none' } });
  box.addEventListener('change', () => onChange(box.checked));
  return el('label.row', { style: { cursor: 'pointer' } }, [
    box,
    el('div.row-main', {}, [
      el('div.row-title', { text }),
      sub ? el('div.row-sub', { text: sub }) : null,
    ]),
  ]);
}

/**
 * Generic list row.
 * @param {{icon?:string|Node, title:string, sub?:string, active?:boolean,
 *          onClick?:Function, actions?:Node[], swatch?:string}} opts
 */
export function row(opts) {
  const node = el(opts.onClick ? 'button.row' : 'div.row', { type: opts.onClick ? 'button' : undefined });
  node.classList.toggle('is-active', Boolean(opts.active));
  if (opts.swatch) node.append(el('span.swatch', { style: { background: opts.swatch } }));
  else if (opts.icon !== undefined) node.append(el('span.row-ico', typeof opts.icon === 'string' ? { text: opts.icon } : {}, typeof opts.icon === 'string' ? [] : [opts.icon]));
  node.append(el('span.row-main', {}, [
    el('span.row-title', { text: opts.title, style: { display: 'block' } }),
    opts.sub ? el('span.row-sub', { text: opts.sub, style: { display: 'block' } }) : null,
  ]));
  if (opts.actions?.length) node.append(el('span.row-act', {}, opts.actions));
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  if (opts.title) node.title = opts.sub ? `${opts.title} — ${opts.sub}` : opts.title;
  return node;
}

/** Tiny square action button used inside rows. */
export function miniBtn(glyph, title, onClick) {
  const btn = el('button.icon-btn', { type: 'button', title, 'aria-label': title, text: glyph, style: { height: '24px', width: '24px', fontSize: '12px' } });
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return btn;
}

/** Row of filter pills. */
export function pillRow(items, activeId, onPick) {
  const node = el('div.pill-row');
  for (const item of items) {
    const btn = el('button.pill', { type: 'button', text: item.label });
    btn.classList.toggle('is-active', item.id === activeId);
    btn.addEventListener('click', () => onPick(item.id));
    node.append(btn);
  }
  return node;
}

/** Collapsible <details> group. */
export const group = (title, children, open = false) =>
  el('details.group', { open }, [
    el('summary', { text: title }),
    el('div.group-body', {}, [].concat(children).filter(Boolean)),
  ]);

export const button = (text, onClick, variant = 'primary', props = {}) => {
  const node = el(`button.btn-${variant}`, { type: 'button', text, ...props });
  node.addEventListener('click', onClick);
  return node;
};

export const stack = (children, gap = '8px') =>
  el('div', { style: { display: 'flex', flexDirection: 'column', gap } }, [].concat(children).filter(Boolean));

export const inline = (children, gap = '6px') =>
  el('div', { style: { display: 'flex', gap, alignItems: 'center' } }, [].concat(children).filter(Boolean));
