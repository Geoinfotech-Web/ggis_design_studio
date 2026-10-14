/**
 * Landing — what a signed-out visitor sees, and all they see.
 *
 * One screen, no scrolling: what the studio is, one real sheet that came out
 * of work like it, and the way in. Templates, contributor layouts and saved projects
 * used to be laid out here; they now live inside the studio, behind the
 * sign-in, where they are part of making a map rather than a brochure for it.
 */

import { $, el, fill } from '../core/dom.js';
import { APP } from '../core/constants.js';
import { openAuthModal } from './auth-modal.js';
import { themeToggle } from './theme.js';
import { sheetUrl } from './preview.js';

let hooks = {};

const MARK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/></svg>';

/**
 * The picture: a real sheet by a contributor, not an illustration of one.
 * This one was chosen because it sits in the interface's own palette — navy,
 * teal and a pale-blue sea on light paper — so it looks like part of the page
 * rather than a screenshot dropped onto it.
 */
const HERO = {
  image: 'soil-moisture-index.jpg',
  title: 'Soil Moisture Index, Lagos State',
  credit: 'Geoinfotech GIS department',
};

function heroSheet() {
  return el('figure.land-sheet', {}, [
    el('img', {
      src: sheetUrl(HERO.image),
      alt: `${HERO.title} — a finished map sheet with a title, coordinate grid, scale bar, legend and north arrow`,
      width: 1600, height: 1128, decoding: 'async',
    }),
    el('figcaption', {}, [
      el('strong', { text: HERO.title }),
      el('span', { text: `Made by the ${HERO.credit}` }),
    ]),
  ]);
}

const STEPS = [
  ['01', 'Choose a study area'],
  ['02', 'Start from new or a template'],
  ['03', 'Add open data'],
  ['04', 'Compose and export'],
];

function authButton(text, mode, className) {
  const btn = el(`button.${className}`, { type: 'button', text });
  btn.addEventListener('click', () => openAuthModal(mode, { onDone: (user) => hooks.onAuthed?.(user) }));
  return btn;
}

export function render() {
  const root = $('#landing');
  if (!root) return;
  fill(root, [
    el('header.land-bar', {}, [
      el('span.land-mark', { html: MARK }),
      el('span.land-wordmark', { text: APP.name }),
      el('span.land-spacer'),
      themeToggle(),
      authButton('Sign in', 'signin', 'land-btn.land-btn--quiet'),
      authButton('Sign up', 'signup', 'land-btn.land-btn--primary'),
    ]),
    el('main.land-main', {}, [
      el('div.land-copy', {}, [
        el('span.land-eyebrow', { text: 'Cartography for everyone' }),
        el('h1', { text: 'Make a map worth printing.' }),
        el('p', { text: 'Pick your area, add ready-made open data, and export a print-quality map. No GIS training needed.' }),
        el('div.land-actions', {}, [
          authButton('Sign up free', 'signup', 'land-btn.land-btn--primary.land-btn--lg'),
          authButton('Sign in', 'signin', 'land-btn.land-btn--outline.land-btn--lg'),
        ]),
      ]),
      heroSheet(),
    ]),
    el('footer.land-steps', {}, STEPS.map(([n, text]) =>
      el('div.land-step', {}, [el('b', { text: n }), el('span', { text })]))),
  ]);
}

/** @param {{onAuthed: (user: object) => void}} callbacks */
export function initLanding(callbacks) {
  hooks = callbacks;
  render();
}

export function showLanding() {
  $('#landing')?.classList.remove('is-hidden', 'is-blurred');
  $('#studio')?.classList.add('is-hidden');
  render();
}
