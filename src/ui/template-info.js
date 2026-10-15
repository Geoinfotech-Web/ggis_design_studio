/**
 * Template cards with a preview button, and the window it opens.
 *
 * The window floats over the map canvas rather than covering the whole
 * studio, so the template is described where it would be laid out. It says
 * what the template is for and what it puts on the page, and offers to use it.
 */

import { $, el } from '../core/dom.js';
import { state } from '../core/store.js';
import { categoryLabel } from '../templates/catalog.js';
import { PAPER_SIZES, basemapSpec } from '../core/constants.js';
import { templatePreview } from './preview.js';

const ELEMENT_LABELS = {
  title: 'Title', subtitle: 'Subtitle', legend: 'Legend', stats: 'Key figures',
  north: 'North arrow', scale: 'Scale bar', credits: 'Credits', inset: 'Locator inset',
  metadata: 'Map information', neatline: 'Neatline frame', logo: 'Logo',
  text: 'Text block', shape: 'Panel',
};

const EYE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

let open = null;   // { node, onKey }

export function closeTemplateInfo() {
  if (!open) return;
  document.removeEventListener('keydown', open.onKey);
  open.node.remove();
  open = null;
}

/** What the template puts on the page, in order, without repeats. */
function elementList(tpl) {
  const seen = new Set();
  for (const item of tpl.elements ?? []) {
    const label = ELEMENT_LABELS[item.type] ?? item.type;
    seen.add(label);
  }
  return [...seen];
}

function facts(tpl) {
  const paper = PAPER_SIZES[tpl.page?.size]?.label ?? tpl.page?.size ?? '—';
  const orientation = PAPER_SIZES[tpl.page?.size]?.fixedOrientation ?? tpl.page?.orientation ?? '';
  const extras = [tpl.terrain && '3-D terrain', tpl.buildings3d && '3-D buildings'].filter(Boolean);
  const rows = [
    ['Style', categoryLabel(tpl.category)],
    ['Page', `${paper}${orientation ? ` · ${orientation}` : ''}`],
    ['Basemap', basemapSpec(tpl.basemap).label ?? tpl.basemap],
  ];
  if (extras.length) rows.push(['View', extras.join(', ')]);
  return el('dl.tpl-info-facts', {}, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
}

/**
 * Open the description window for a template over the map canvas.
 * @param {object} tpl
 * @param {(tpl: object) => void} onUse  called by "Use this template"
 */
export function showTemplateInfo(tpl, onUse) {
  closeTemplateInfo();
  const host = $('#canvas-wrap') ?? document.body;

  const close = el('button.tpl-info-close', { type: 'button', text: '×', 'aria-label': 'Close preview' });
  const use = el('button.btn-primary.tpl-info-use', { type: 'button', text: tpl.id === state.templateId && state.mapStarted ? 'Re-apply this template' : 'Use this template' });
  const cancel = el('button.btn-ghost', { type: 'button', text: 'Close' });

  const thumb = el('div.tpl-info-thumb', {}, [templatePreview(tpl)]);
  thumb.classList.toggle('is-landscape', (PAPER_SIZES[tpl.page?.size]?.fixedOrientation ?? tpl.page?.orientation) === 'landscape');

  const node = el('div.tpl-info', { role: 'dialog', 'aria-modal': 'false', 'aria-label': `${tpl.name} template` }, [
    close,
    thumb,
    el('div.tpl-info-body', {}, [
      el('span.tpl-info-eyebrow', { text: `${categoryLabel(tpl.category)} template` }),
      el('h3', { text: tpl.name }),
      el('p', { text: tpl.blurb }),
      facts(tpl),
      el('div.tpl-info-label', { text: 'On the page' }),
      el('div.tpl-info-chips', {}, elementList(tpl).map((t) => el('span', { text: t }))),
      tpl.tags?.length ? el('div.tpl-info-tags', { text: tpl.tags.join(' · ') }) : null,
      el('div.tpl-info-actions', {}, [cancel, use]),
    ]),
  ]);

  close.addEventListener('click', closeTemplateInfo);
  cancel.addEventListener('click', closeTemplateInfo);
  use.addEventListener('click', () => { closeTemplateInfo(); onUse(tpl); });
  const onKey = (event) => { if (event.key === 'Escape') closeTemplateInfo(); };
  document.addEventListener('keydown', onKey);

  host.append(node);
  open = { node, onKey };
  use.focus();
}

/**
 * A template card: click the card to use it, or the eye at the bottom to read
 * about it first.
 */
export function templateCard(tpl, { active = false, onUse }) {
  const pick = el('button.tpl-card-pick', { type: 'button', title: `${tpl.name} — ${tpl.blurb}` }, [
    el('div.tpl-thumb', {}, [templatePreview(tpl)]),
    el('div.tpl-meta', {}, [el('strong', { text: tpl.name }), el('span', { text: tpl.tags.join(' · ') })]),
  ]);
  pick.addEventListener('click', () => { closeTemplateInfo(); onUse(tpl); });

  const preview = el('button.tpl-card-preview', {
    type: 'button', title: `Preview ${tpl.name}`, 'aria-label': `Preview ${tpl.name}`,
    html: `${EYE}<span>Preview</span>`,
  });
  preview.addEventListener('click', () => showTemplateInfo(tpl, onUse));

  const card = el('div.tpl-card', {}, [pick, preview]);
  card.classList.toggle('is-active', active);
  return card;
}
