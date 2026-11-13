/**
 * The part of the map area you can actually see.
 *
 * On a laptop that is the whole canvas between the side panels. On a phone or
 * tablet (≤ 900 px) the panels are sheets that slide up over the lower part
 * of the map, so the usable area is the strip above the sheet. The page frame
 * is laid out in this rectangle, and "zoom to area" fits into it, so the
 * printed page always sits where it can be seen.
 */

const NARROW = '(max-width: 900px)';
export const isNarrowScreen = () => window.matchMedia(NARROW).matches;

/** Sheets currently covering part of the map (none on a wide screen). */
function openSheets() {
  if (!isNarrowScreen()) return [];
  return ['left-panel', 'right-panel']
    .map((id) => document.getElementById(id))
    .filter((panel) => panel && getComputedStyle(panel).visibility === 'visible');
}

/**
 * The visible region of `wrap` (the canvas element), in px relative to it.
 * A sheet still sliding in counts at its resting position, because its
 * computed top is set by the stylesheet, not by the animation.
 * @returns {{left:number, top:number, width:number, height:number, covered:number}}
 */
export function visibleRect(wrap) {
  const box = wrap.getBoundingClientRect();
  let bottom = box.height;
  for (const sheet of openSheets()) {
    const sheetTop = sheet.offsetTop;           // resting position, ignores the slide transform
    const top = sheet.offsetParent === wrap.offsetParent ? sheetTop - wrap.offsetTop : sheet.getBoundingClientRect().top - box.top;
    bottom = Math.min(bottom, Math.max(0, top));
  }
  return { left: 0, top: 0, width: box.width, height: bottom, covered: box.height - bottom };
}
