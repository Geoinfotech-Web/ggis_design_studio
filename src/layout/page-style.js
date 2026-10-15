/**
 * The page's own look: the paper colour (with its opacity) and an optional
 * border round the sheet. Read by the artboard on screen and by the exporter,
 * so the two can only ever agree.
 *
 * Border widths are in the same units as element styles — thousandths of the
 * page width — so a border is the same share of the sheet at any size or dpi.
 */

/** '#rrggbb' (or '#rgb') at an opacity, as rgba(); anything else passes through. */
export function withOpacity(color, opacity = 1) {
  const a = Math.max(0, Math.min(1, Number(opacity ?? 1)));
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color ?? '').trim());
  if (!m) return color ?? `rgba(255,255,255,${a})`;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Page look with defaults filled in. */
export function pageStyle(page = {}) {
  return {
    background: page.background ?? '#ffffff',
    backgroundOpacity: page.backgroundOpacity ?? 1,
    borderColor: page.borderColor ?? '#0f172a',
    borderWidth: Number(page.borderWidth ?? 0),
    borderOpacity: page.borderOpacity ?? 1,
  };
}

/** The paper fill, opacity included. */
export const paperFill = (page) => {
  const s = pageStyle(page);
  return withOpacity(s.background, s.backgroundOpacity);
};

/** The page border as a CSS colour, or null when there is none. */
export const pageBorderColor = (page) => {
  const s = pageStyle(page);
  return s.borderWidth > 0 ? withOpacity(s.borderColor, s.borderOpacity) : null;
};
