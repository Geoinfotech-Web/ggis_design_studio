/**
 * My projects pane — every map this account has saved, newest first.
 *
 * This is the history of previous maps: open one to carry on, or start a new
 * one. It is always reachable, including before a study area is chosen,
 * because reopening an old map is a perfectly good way to begin.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, subscribe, listProjects, deleteProject, librarySyncFailing } from '../../core/store.js';
import { templateById, galleryTemplates } from '../../templates/catalog.js';
import { templatePreview } from '../preview.js';
import { head, section, button, empty } from '../controls.js';
import { uiIcon } from '../ui-icons.js';

let pane;
let hooks = {};
let query = '';

function thumb(entry) {
  if (entry.thumb) return el('div.proj-thumb', {}, [el('img', { src: entry.thumb, alt: '' })]);
  const tpl = templateById(entry.templateId) ?? galleryTemplates('all')[0];
  return el('div.proj-thumb', {}, tpl ? [templatePreview(tpl)] : []);
}

const savedLabel = (ms) => {
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'Edited today';
  if (days === 1) return 'Edited yesterday';
  if (days < 7) return `Edited ${days} days ago`;
  return `Edited ${new Date(ms).toLocaleDateString()}`;
};

function card(entry) {
  const current = entry.id === state.projectId;
  const open = el('button.proj-open', { type: 'button', title: current ? 'This map is open' : `Open ${entry.name}` }, [
    thumb(entry),
    el('span.proj-text', {}, [
      el('strong', { text: entry.name || 'Untitled map' }),
      el('span', { text: `${templateById(entry.templateId)?.name ?? 'Custom'} · ${savedLabel(entry.savedAt)}` }),
    ]),
    current ? el('span.proj-badge', { text: 'Open' }) : null,
  ]);
  open.addEventListener('click', () => { if (!current) hooks.openProject?.(entry.id); });

  const remove = el('button.icon-btn.is-danger.proj-delete', {
    type: 'button', title: `Delete “${entry.name}”`, 'aria-label': `Delete ${entry.name}`,
  }, [uiIcon('trash', 15)]);
  remove.addEventListener('click', () => {
    if (!window.confirm(`Delete “${entry.name}”? This cannot be undone.`)) return;
    deleteProject(entry.id);
    render();
  });

  const node = el('div.proj-card', {}, [open, remove]);
  node.classList.toggle('is-current', current);
  return node;
}

export function render() {
  pane = pane ?? $('#pane-projects');
  if (!pane) return;

  const all = listProjects();
  const needle = query.trim().toLowerCase();
  const shown = needle ? all.filter((p) => (p.name ?? '').toLowerCase().includes(needle)) : all;

  const search = el('input.field', { type: 'search', placeholder: 'Find a project', 'aria-label': 'Find a project', value: query });
  search.addEventListener('input', () => {
    query = search.value;
    render();
    const again = $('#pane-projects input[type="search"]');
    again?.focus();
    again?.setSelectionRange(query.length, query.length);
  });

  fill(pane, [
    head('My projects', all.length
      ? `${all.length} saved to your account · open them from any computer`
      : 'Maps you make are saved to your account as you work.'),
    librarySyncFailing() ? el('p.proj-sync-warn', { text: 'Not connected to the account service — changes are kept in this browser and sent up when it is back.' }) : null,
    section('', [
      button('New map', () => hooks.newMap?.(), 'primary', { style: { width: '100%' } }),
    ]),
    all.length
      ? section('', [
          all.length > 4 ? search : null,
          el('div.proj-list', {}, shown.length ? shown.map(card) : [empty('No project matches that name.')]),
        ])
      : empty('Nothing saved yet. Choose a study area and start a map — it is saved automatically.'),
  ]);
}

/** @param {{openProject: (id: string) => void, newMap: () => void}} callbacks */
export function initProjectsPane(callbacks) {
  hooks = callbacks;
  pane = $('#pane-projects');
  render();
  subscribe(['projectId', 'projectName'], () => { if (state.activeTool === 'projects') render(); });
}

export { render as renderProjectsPane };
