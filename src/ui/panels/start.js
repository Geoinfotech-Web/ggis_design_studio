/**
 * Start map pane — the second step.
 *
 * With a study area chosen, there are three honest ways to begin: an empty
 * page, a finished cartographic template, or a layout a contributor has
 * already used on a real sheet. Whichever is picked, the study area is kept
 * and the data and layout tools open.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, set, subscribe } from '../../core/store.js';
import { notify } from '../../core/toast.js';
import { GALLERY_CATEGORIES, galleryTemplates, templateById } from '../../templates/catalog.js';
import { applyTemplate } from '../../templates/apply.js';
import { CONTRIBUTIONS, CONTRIBUTOR } from '../../data/contributions.js';
import { templatePreview, sheetUrl } from '../preview.js';
import { templateCard } from '../template-info.js';
import { PAPER_SIZES, paperDimsLabel } from '../../core/constants.js';
import { resizeSoon } from '../../core/map.js';
import { formatArea } from '../../core/geo.js';
import { layoutArtboard, renderElements, hint } from '../artboard.js';
import { head, section, pillRow, select, labelled, button, stack, seg } from '../controls.js';
import { setTool } from '../tool.js';

let pane;
let choice = 'template';            // which of the three is expanded
let category = 'all';
let blankPage = { size: 'a4', orientation: 'landscape' };
let showAllSheets = false;
let changing = false;               // reopening the choices on a map already started

const ICONS = {
  new: 'M6 3h9l4 4v14H6zM12 11v6M9 14h6',
  template: 'M4 4h16v6H4zM4 13h7v7H4zM14 13h6v7h-6z',
  contributor: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 2.7-5 6-5s6 2 6 5M17 11a2.5 2.5 0 1 0 0-5M17 15c2.3.3 4 2 4 5',
};
const icon = (name) => el('span.start-ico', {
  html: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`,
});

/**
 * Begin (or restart) the map from a template id. The study area is not
 * touched: applyTemplate() swaps page, elements and look, and fills the
 * title from the area that is already loaded.
 */
function startMap(templateId, { page, label } = {}) {
  const tpl = applyTemplate(templateId);
  if (!tpl) {
    notify.error('That starting point could not be loaded.');
    return;
  }
  if (page) set({ page: { ...state.page, ...page } }, { history: false });

  const wasStarted = state.mapStarted;
  if (!wasStarted && state.studyArea && state.projectName === 'Untitled map') {
    set({ projectName: `${state.studyArea.name} map` }, { history: false });
    const name = $('#project-name');
    if (name) name.value = state.projectName;
  }
  set({ mapStarted: true }, { history: false });
  changing = false;

  layoutArtboard();
  renderElements();
  resizeSoon(80);

  notify.ok(`Started from <b>${label ?? tpl.name}</b>. Your study area is kept.`);
  if (!wasStarted) {
    setTool('data');
    hint('Next: add <b>data</b> on the left. Everything on the page can be moved and restyled.', 6500);
  } else {
    render();
  }
}

/* ------------------------------------------------------------------ */
function optionCard(id, title, body, content) {
  const open = choice === id;
  const headBtn = el('button.start-option-head', { type: 'button', 'aria-expanded': String(open) }, [
    icon(id),
    el('span.start-option-text', {}, [el('strong', { text: title }), el('small', { text: body })]),
  ]);
  headBtn.addEventListener('click', () => { choice = id; render(); });
  const card = el('div.start-option', {}, [headBtn, open ? el('div.start-option-body', {}, content()) : null]);
  card.classList.toggle('is-open', open);
  return card;
}

function newMapBody() {
  const paper = PAPER_SIZES[blankPage.size] ?? PAPER_SIZES.a4;
  const fixed = paper.fixedOrientation;
  return [
    labelled('Paper size', select(
      Object.entries(PAPER_SIZES).map(([value, p]) => ({ value, label: `${p.label} · ${paperDimsLabel(p)}` })),
      blankPage.size,
      (value) => { blankPage = { ...blankPage, size: value }; render(); },
    )),
    labelled('Orientation', seg(
      [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }],
      fixed ?? blankPage.orientation,
      (value) => { blankPage = { ...blankPage, orientation: value }; render(); },
    ), fixed ? `${paper.label} is always ${fixed}.` : ''),
    button('Start a blank map', () => startMap('blank', {
      page: { size: blankPage.size, orientation: fixed ?? blankPage.orientation },
      label: 'a blank page',
    }), 'primary', { style: { width: '100%' } }),
  ];
}

function templateBody() {
  const grid = el('div.tpl-grid.tpl-grid--flush', {}, galleryTemplates(category).map((tpl) => templateCard(tpl, {
    active: state.mapStarted && tpl.id === state.templateId,
    onUse: () => startMap(tpl.id),
  })));
  return [
    pillRow(GALLERY_CATEGORIES, category, (id) => { category = id; render(); }),
    grid,
  ];
}

function previewSheet(item, image) {
  const dialog = el('dialog.contributor-lightbox', {}, [
    el('button.lightbox-close', { type: 'button', text: '×', 'aria-label': 'Close preview' }),
    el('img', { src: image, alt: `${item.title} map by ${CONTRIBUTOR}` }),
    el('div.lightbox-caption', {}, [el('strong', { text: item.title }), el('span', { text: `${item.topic} · ${item.place}` })]),
  ]);
  dialog.querySelector('.lightbox-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

function contributorBody() {
  // A short list is shown whole; only a long one is folded behind "Show all".
  const folds = CONTRIBUTIONS.length > 8;
  const visible = showAllSheets || !folds ? CONTRIBUTIONS : CONTRIBUTIONS.slice(0, 6);
  const more = folds ? el('button.start-more', {
    type: 'button',
    text: showAllSheets ? 'Show fewer' : `Show all ${CONTRIBUTIONS.length} sheets`,
  }) : null;
  more?.addEventListener('click', () => { showAllSheets = !showAllSheets; render(); });

  return [
    el('p.start-note', { text: `Real sheets by the ${CONTRIBUTOR}. Use one and you get its layout — margins, title, key and scale — around your own study area.` }),
    el('div.sheet-list', {}, visible.map((item) => {
      const image = sheetUrl(item.image);
      const thumb = el('button.sheet-thumb', { type: 'button', title: `View ${item.title}`, 'aria-label': `View ${item.title}` }, [
        el('img', { src: image, alt: '', loading: 'lazy' }),
      ]);
      thumb.addEventListener('click', () => previewSheet(item, image));
      const use = el('button.btn-soft', { type: 'button', text: 'Use layout' });
      use.addEventListener('click', () => startMap(item.templateId, { label: `the “${item.title}” layout` }));
      return el('div.sheet-row', {}, [
        thumb,
        el('div.sheet-text', {}, [
          el('strong', { text: item.title }),
          el('span', { text: `${item.topic} · ${item.place}` }),
          el('span.sheet-tpl', { text: `${item.traced ? 'Traced into' : 'Built on'} ${templateById(item.templateId)?.name ?? 'a studio template'}` }),
        ]),
        use,
      ]);
    })),
    more,
  ];
}

/* ------------------------------------------------------------------ */
function areaSummary() {
  const area = state.studyArea;
  const change = el('button.start-change', { type: 'button', text: 'Change' });
  change.addEventListener('click', () => setTool('area'));
  return el('div.start-area', {}, [
    el('span.start-area-tick', { html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>' }),
    el('span.start-area-name', { text: `Study area: ${area.name}${area.areaKm2 ? ` · ${formatArea(area.areaKm2)}` : ''}` }),
    change,
  ]);
}

function choices() {
  return el('div.start-options', {}, [
    optionCard('new', 'New map', 'A blank page. You pick the size and build it up yourself.', newMapBody),
    optionCard('template', 'Template', 'A finished layout and style, fitted to your study area.', templateBody),
    optionCard('contributor', 'Contributor', 'Start from a layout proven on a real published sheet.', contributorBody),
  ]);
}

export function render() {
  pane = pane ?? $('#pane-start');
  if (!pane) return;

  if (!state.studyArea) {
    fill(pane, [
      head('Start map', 'Choose how to begin once your map has a study area.'),
      el('div.panel-empty', { text: 'Choose a study area first.' }),
    ]);
    return;
  }

  if (state.mapStarted && !changing) {
    const tpl = templateById(state.templateId);
    fill(pane, [
      head('Start map', 'Your map is under way.'),
      section('', stack([
        areaSummary(),
        el('div.start-current', {}, [
          el('div.tpl-thumb', {}, tpl ? [templatePreview(tpl)] : []),
          el('div', {}, [
            el('span.panel-title', { text: 'Started from' }),
            el('strong', { text: tpl?.name ?? 'Custom layout' }),
          ]),
        ]),
        button('Map style, basemap and page', () => setTool('templates'), 'soft', { style: { width: '100%' } }),
        button('Choose a different starting point', () => { changing = true; render(); }, 'ghost', { style: { width: '100%' } }),
      ])),
    ]);
    return;
  }

  fill(pane, [
    head(changing ? 'Change starting point' : 'Start your map', changing
      ? 'Picking another one replaces the page layout. Your study area and data stay.'
      : 'How do you want to begin?'),
    section('', [areaSummary()]),
    section('', [choices()]),
    changing ? section('', [button('Keep the current layout', () => { changing = false; render(); }, 'ghost', { style: { width: '100%' } })]) : null,
  ]);
}

export function initStartPane() {
  pane = $('#pane-start');
  render();
  subscribe(['studyArea', 'mapStarted', 'templateId'], () => { if (state.activeTool === 'start') render(); });
}

export { render as renderStartPane };
