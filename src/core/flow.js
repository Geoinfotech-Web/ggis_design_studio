/**
 * The order the studio opens up in.
 *
 * A map is about a place, so nothing else is offered until there is one:
 * first a study area, then a starting point (new, template or contributor
 * layout), and only then the data, layout and styling tools. This module is
 * the one statement of that rule; the rail, the step chain, the panels and
 * the right-hand inspector all ask it rather than each deciding for
 * themselves.
 */

import { state } from './store.js';

/** 'area' → 'start' → 'open' */
export const stage = () => (!state.studyArea ? 'area' : !state.mapStarted ? 'start' : 'open');

/** Panels that are part of the work on a map, as opposed to getting to one. */
const GATED = new Set(['templates', 'data', 'elements', 'layers', 'ai']);

export function toolLocked(id) {
  const now = stage();
  if (id === 'start') return now === 'area';
  if (GATED.has(id)) return now !== 'open';
  return false;                       // the study area and My projects are always reachable
}

/** Why a tool is closed, phrased as what to do next. */
export const lockReason = () => (stage() === 'area'
  ? 'Choose a study area first — the other tools open once your map has a place.'
  : 'Choose how to start your map — new, a template or a contributor layout — and the tools will open.');

export const studioLocked = () => stage() !== 'open';
