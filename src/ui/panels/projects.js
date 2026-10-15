/**
 * My projects pane — every map this account has saved, newest first.
 *
 * This is the history of previous maps: open one to carry on, or start a new
 * one. It is always reachable, including before a study area is chosen,
 * because reopening an old map is a perfectly good way to begin.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, subscribe, listProjects, deleteProject, renameProject, librarySyncFailing } from '../../core/store.js';
import { notify } from '../../core/toast.js';
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

  const remove = el('button.icon-btn.is-danger', {
    type: 'button', title: `Delete “${entry.name}”`, 'aria-label': `Delete ${entry.name}`,
  }, [uiIcon('trash', 15)]);
  remove.addEventListener('click', () => {
    if (!window.confirm(`Delete “${entry.name}”? This cannot be undone.`)) return;
    deleteProject(entry.id);
    render();
  });

  const rename = el('button.icon-btn', {
    type: 'button', title: `Rename “${entry.name}”`, 'aria-label': `Rename ${entry.name}`,
    html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  });
  rename.addEventListener('click', () => startRename(node, entry));

  const node = el('div.proj-card', {}, [open, el('div.proj-actions', {}, [rename, remove])]);
  node.classList.toggle('is-current', current);
  return node;
}

/**
 * Swap the card's name for a field. Enter or leaving the field saves; Esc
 * puts the old name back.
 */
function startRename(node, entry) {
  const openBtn = node.querySelector('button.proj-open');
  if (!openBtn || node.querySelector('.proj-rename')) return;
  const input = el('input.field.proj-rename', {
    type: 'text', value: entry.name || 'Untitled map', 'aria-label': 'Project name', maxlength: '120',
  });
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    if (save && next && next !== entry.name) {
      const result = renameProject(entry.id, next);
      if (!result.ok) notify.warn(result.error ?? 'That name could not be saved.');
      else if (entry.id === state.projectId) {
        const header = $('#project-name');
        if (header) header.value = next;
      }
    }
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  // The card's open button is swapped for a plain row while renaming: a field
  // inside a button would hand Enter and Space to the button and open the map.
  const editing = el('div.proj-open.is-renaming', {}, [
    openBtn.querySelector('.proj-thumb')?.cloneNode(true),
    el('span.proj-text', {}, [input, el('span', { text: 'Enter to save · Esc to cancel' })]),
  ]);
  openBtn.replaceWith(editing);
  input.focus();
  input.select();
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
