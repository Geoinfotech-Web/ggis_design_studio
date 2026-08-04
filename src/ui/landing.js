/**
 * Landing page — "what are you mapping today?".
 *
 * Deliberately shaped like a design tool's home rather than a GIS one:
 * a search box, six one-click starting points, and a wall of finished
 * looks. Nothing here mentions projections or layers; that vocabulary
 * only appears once you are inside the studio.
 */

import { $, el, fill } from '../core/dom.js';
import { state, loadProject, clearProject } from '../core/store.js';
import { APP } from '../core/constants.js';
import { TEMPLATES, TEMPLATE_CATEGORIES, templatesInCategory, templateById } from '../templates/catalog.js';
import { templatePreview } from './preview.js';
import { openCreateModal } from './create-modal.js';

let filter = 'all';
let api = {};

/* ------------------------------------------------------------------ */
const BRAND_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`;

const RAIL = [
  { id: 'home', icon: '⌂', label: 'Home' },
  { id: 'templates', icon: '◫', label: 'Templates' },
  { id: 'projects', icon: '❒', label: 'Projects' },
  { id: 'learn', icon: '?', label: 'Guide' },
];

const QUICK = [
  { id: 'blank', label: 'Blank map', icon: '＋', color: 'linear-gradient(135deg,#0ea5e9,#0369a1)', template: 'blank', tool: 'area' },
  { id: 'landcover', label: 'Land cover', icon: '▩', color: 'linear-gradient(135deg,#34d399,#0f766e)', template: 'land-cover', tool: 'analysis' },
  { id: 'flood', label: 'Flood extent', icon: '≋', color: 'linear-gradient(135deg,#60a5fa,#1d4ed8)', template: 'dark-dashboard', tool: 'analysis' },
  { id: 'spill', label: 'Oil spill', icon: '◒', color: 'linear-gradient(135deg,#64748b,#0f172a)', template: 'oil-spill', tool: 'analysis' },
  { id: 'terrain', label: 'Terrain 3-D', icon: '⛰', color: 'linear-gradient(135deg,#a3e635,#4d7c0f)', template: 'terrain-3d', tool: 'templates' },
  { id: 'report', label: 'Report sheet', icon: '▤', color: 'linear-gradient(135deg,#fbbf24,#b45309)', template: 'field-report', tool: 'data' },
];

/* ------------------------------------------------------------------ */
function railNode() {
  return [
    el('div.home-brand', { html: BRAND_SVG, title: APP.name }),
    ...RAIL.map((item, i) => {
      const btn = el('button.home-rail-btn', { type: 'button' }, [
        el('span.home-rail-ico', { text: item.icon }),
        el('span', { text: item.label }),
      ]);
      btn.classList.toggle('is-active', i === 0);
      btn.addEventListener('click', () => {
        const target = { templates: '#home-templates', projects: '#home-projects', learn: '#home-learn', home: '#home-hero' }[item.id];
        $(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return btn;
    }),
  ];
}

function heroNode() {
  const input = el('input', {
    type: 'search',
    placeholder: 'Search a place — “Rivers State”, “Lagos”, “Yankari National Park”…',
    'aria-label': 'Search for a place to map',
  });
  const go = () => {
    const query = input.value.trim();
    if (!query) { openCreateModal(api); return; }
    api.openStudio({ templateId: 'quiet-canvas', tool: 'area', place: query });
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

  const search = el('div.home-search', {}, [
    el('span', { text: '⌕', style: { fontSize: '19px', color: '#94a3b8' } }),
    input,
    (() => {
      const btn = el('button', { type: 'button', text: 'Start mapping' });
      btn.addEventListener('click', go);
      return btn;
    })(),
  ]);

  const quick = el('div.quick-row', {}, QUICK.map((q) => {
    const btn = el('button.quick-action', { type: 'button', title: q.label }, [
      el('span.quick-bubble', { text: q.icon, style: { background: q.color } }),
      el('span', { text: q.label }),
    ]);
    btn.addEventListener('click', () => api.openStudio({ templateId: q.template, tool: q.tool }));
    return btn;
  }));

  return el('div.home-hero#home-hero', {}, [
    el('h1', { text: 'What are you mapping today?' }),
    el('p', { text: 'Pick a look, choose your place, drop in open data, run the analysis you need — and export a print-ready map. No GIS training required.' }),
    search,
    quick,
  ]);
}

/* ------------------------------------------------------------------ */
function showcaseNode() {
  const grid = el('div.showcase', {}, templatesInCategory(filter).map((tpl) => {
    const card = el('button.showcase-card', { type: 'button', title: tpl.blurb }, [
      templatePreview(tpl),
      el('h3', { text: tpl.name }),
      el('p', { text: tpl.blurb }),
      el('div.showcase-tags', {}, tpl.tags.map((t) => el('span.chip', { text: t }))),
    ]);
    card.addEventListener('click', () => api.openStudio({ templateId: tpl.id, tool: 'area' }));
    return card;
  }));

  const pills = el('div.filter-row', {}, TEMPLATE_CATEGORIES.map((cat) => {
    const btn = el('button.filter-btn', { type: 'button', text: cat.label });
    btn.classList.toggle('is-active', cat.id === filter);
    btn.addEventListener('click', () => { filter = cat.id; render(); });
    return btn;
  }));

  return el('section.home-section#home-templates', {}, [
    el('div.section-head', {}, [
      el('div', {}, [
        el('h2', { text: 'Start with a look' }),
        el('p', { text: `${TEMPLATES.length} finished designs — artistic, vintage, cartographic, 3-D and analysis-ready.` }),
      ]),
      (() => {
        const btn = el('button', { type: 'button', text: 'Create from scratch →' });
        btn.addEventListener('click', () => openCreateModal(api));
        return btn;
      })(),
    ]),
    pills,
    grid,
  ]);
}

/* ------------------------------------------------------------------ */
function projectsNode() {
  const saved = loadProject();
  const cards = [];

  if (saved?.doc) {
    const tpl = templateById(saved.doc.templateId) ?? TEMPLATES[0];
    const card = el('button.project-card', { type: 'button' }, [
      el('div.project-thumb', {}, [templatePreview(tpl)]),
      el('h3', { text: saved.doc.projectName || 'Untitled map' }),
      el('p', { text: `${tpl.name} · saved ${new Date(saved.savedAt).toLocaleString()}` }),
    ]);
    card.addEventListener('click', () => api.restoreProject(saved.doc));
    cards.push(card);
  }

  const newCard = el('button.project-card', { type: 'button' }, [
    el('div.project-thumb', { style: { display: 'grid', placeItems: 'center', border: '2px dashed #cbd5e1', background: '#f8fafc', color: '#94a3b8', fontSize: '30px' }, text: '＋' }),
    el('h3', { text: 'New map' }),
    el('p', { text: 'Start from a template or a blank page' }),
  ]);
  newCard.addEventListener('click', () => openCreateModal(api));
  cards.push(newCard);

  return el('section.home-section#home-projects', {}, [
    el('div.section-head', {}, [
      el('div', {}, [
        el('h2', { text: 'Your projects' }),
        el('p', { text: 'Saved in this browser only — nothing is uploaded anywhere.' }),
      ]),
      saved?.doc ? (() => {
        const btn = el('button', { type: 'button', text: 'Clear saved project' });
        btn.addEventListener('click', () => { clearProject(); render(); });
        return btn;
      })() : null,
    ]),
    el('div.project-grid', {}, cards),
  ]);
}

/* ------------------------------------------------------------------ */
function learnNode() {
  const steps = [
    ['1', 'Pick a look', 'Every template is a finished design — page size, colours, legend and all. Change any of it later.'],
    ['2', 'Choose your place', 'Search a country, state, LGA or any named place. The real administrative boundary is drawn for you.'],
    ['3', 'Add data', 'Roads, rivers, hospitals, buildings and more, straight from OpenStreetMap. Or drop in your own file.'],
    ['4', 'Run an analysis', 'Land cover, flood extent, vegetation health, oil-spill detection — chosen by the question, not the band maths.'],
    ['5', 'Arrange and export', 'Drag the title, legend and arrow wherever you want, then export a print-ready PDF or PNG.'],
  ];

  return el('section.home-section#home-learn', {}, [
    el('div.section-head', {}, [
      el('div', {}, [
        el('h2', { text: 'How it works' }),
        el('p', { text: 'Five steps, no GIS vocabulary required.' }),
      ]),
    ]),
    el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: '16px' } },
      steps.map(([num, title, body]) => el('div.card', { style: { padding: '16px' } }, [
        el('div', { text: num, style: { display: 'grid', placeItems: 'center', width: '28px', height: '28px', borderRadius: '50%', background: '#e0f2fe', color: '#0369a1', fontWeight: '800', fontSize: '13px', marginBottom: '10px' } }),
        el('h3', { text: title, style: { margin: '0 0 5px', fontSize: '15px' } }),
        el('p', { text: body, style: { margin: 0, fontSize: '12.5px', lineHeight: '1.5', color: '#64748b' } }),
      ]))),
    el('p', {
      style: { margin: '24px 0 0', fontSize: '11.5px', color: '#94a3b8', lineHeight: '1.6', textAlign: 'center' },
      html: `${APP.name} ${APP.version} · ${APP.org} · Basemaps © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors · Boundaries via Nominatim · Feature data © OpenStreetMap contributors`,
    }),
  ]);
}

/* ------------------------------------------------------------------ */
export function render() {
  const rail = $('#home-rail');
  const main = $('#home-main');
  if (!rail || !main) return;
  fill(rail, railNode());
  fill(main, [heroNode(), showcaseNode(), projectsNode(), learnNode()]);
}

export function initLanding(hooks) {
  api = hooks;
  render();
}

export function showLanding() {
  $('#landing')?.classList.remove('is-hidden');
  $('#studio')?.classList.add('is-hidden');
  render();
}

export { render as renderLanding };
