/**
 * Template thumbnails.
 *
 * The artwork itself lives in src/styles/previews.css as `.pv-<id>` — pure
 * CSS gradients, no images and no network. This module only layers the
 * shared map furniture (neatline, north arrow, scale bar, inset, grid) on
 * top, driven by each template's `preview` list.
 */

import { el } from '../core/dom.js';
import { categoryLabel } from '../templates/catalog.js';

const FURNITURE = {
  label: (tpl) => el('span.pv-label', { text: categoryLabel(tpl.category) }),
  neatline: (tpl) => el('span.pv-neatline', { 'data-title': tpl.name.toUpperCase() }),
  north: () => el('span.pv-north', { text: 'N' }),
  scale: () => el('span.pv-scale'),
  inset: () => el('span.pv-inset'),
  grid: () => el('span.pv-grid'),
  coords: () => el('span.pv-coords', { text: '7°29′E' }),
};

/** The thumbnail node for a template. */
export function templatePreview(tpl) {
  const node = el(`div.pv.pv-${tpl.id}`);
  for (const key of tpl.preview ?? []) {
    const make = FURNITURE[key];
    if (make) node.append(make(tpl));
  }
  return node;
}
