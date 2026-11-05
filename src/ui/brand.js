/**
 * The Mappix Studio logo, in one place.
 *
 * The mark is a ridge, a peak under it and a blue summit — drawn as inline
 * SVG so it stays sharp at every size. The dark parts take the interface's
 * ink colour, which turns light in dark mode; the summit is always Mappix
 * blue. The wordmark is live text in Poppins (loaded in index.html), so it
 * scales with the rest of the type.
 *
 * Static copies for outside the app — favicon, README, documents — are in
 * public/favicon.svg and docs/assets/.
 */

import { el } from '../core/dom.js';

export const BRAND_BLUE = '#1667F4';

const MARK_PATHS = `
  <path class="mx-ink" d="M30 478L30 372Q30 352 44 338L282 102Q345 48 408 102L560 244Q612 292 664 280Q700 270 740 248Q790 222 834 256L904 318Q932 344 906 366L792 454Q702 522 618 458L402 268Q345 220 288 268L44 492Q30 504 30 478Z"/>
  <path class="mx-ink" d="M108 486L272 318Q332 270 392 318L548 486Z"/>
  <path class="mx-blue" d="M538 156L628 66Q676 26 724 66L926 258Q862 182 784 188Q730 194 686 228Q640 256 598 226Q566 202 538 156Z"/>`;

/** The mark alone, `height` pixels tall (it is about 1.9 times as wide). */
export function markSvg(height = 24) {
  const width = Math.round(height * (920 / 490));
  return `<svg class="mx-mark" width="${width}" height="${height}" viewBox="20 20 920 490" role="img" aria-label="Mappix Studio">${MARK_PATHS}</svg>`;
}

/**
 * Mark + "Mappix" + "STUDIO", as in the brand artwork.
 * @param {{ size?: number }} [opts]  size: height of the mark in pixels
 */
export function brandLogo({ size = 28 } = {}) {
  const logo = el('span.mx-logo', {}, [
    el('span.mx-logo-mark', { html: markSvg(size), 'aria-hidden': 'true' }),
    el('span.mx-logo-word', {}, [
      el('span.mx-logo-name', { text: 'Mappix' }),
      el('span.mx-logo-sub', { text: 'Studio' }),
    ]),
  ]);
  // A custom property has to be set with setProperty; Object.assign on
  // style (what el() does) silently ignores it.
  logo.style.setProperty('--mx-size', `${size}px`);
  return logo;
}
