import { describe, it, expect } from 'vitest';
import {
  TRANSPARENT, isTransparent, cssColor, sampleRamp, shade, dashArray,
  singleSymbology, categorisedSymbology, graduatedSymbology, valuesIn,
  paintColor, legendRowsFor, baseWidthOf, lineWidth, swatchStroke,
  dashGroups, patchCategory, patchClass, patchBucket, applyRamp, reverseRamp,
  DEFAULT_LINE_WIDTH_MM,
} from '../src/layers/symbology.js';
import { fc, point } from './fixtures.js';

/** Pull every colour-looking string out of a MapLibre paint expression. */
const colorsIn = (expr) => {
  const out = [];
  const walk = (node) => {
    if (typeof node === 'string' && /^#|rgba?\(/.test(node)) out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
  };
  walk(expr);
  return out;
};

describe('transparent sentinel', () => {
  it('recognises the cartographic "no colour"', () => {
    expect(isTransparent(TRANSPARENT)).toBe(true);
    expect(isTransparent('none')).toBe(true);
    expect(isTransparent('')).toBe(true);
    expect(isTransparent('#ffffff')).toBe(false);
  });
  it('cssColor converts it to a paintable rgba and leaves real colours alone', () => {
    expect(cssColor(TRANSPARENT)).toBe('rgba(0,0,0,0)');
    expect(cssColor('#123456')).toBe('#123456');
  });
});

describe('ramp sampling', () => {
  it('returns the endpoints exactly', () => {
    const ramp = ['#000000', '#ff0000', '#ffffff'];
    expect(sampleRamp(ramp, 0)).toBe('#000000');
    expect(sampleRamp(ramp, 1)).toBe('#ffffff');
  });
  it('mixes between stops', () => {
    expect(sampleRamp(['#000000', '#ffffff'], 0.5)).toBe('#808080');
  });
  it('passes a single colour straight through', () => {
    expect(sampleRamp(['#abcdef'], 0.7)).toBe('#abcdef');
  });
});

describe('shade', () => {
  it('is a no-op at t=0', () => {
    expect(shade('#808080', 0)).toBe('#808080');
  });
  it('lightens toward white and darkens toward black', () => {
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(shade('#808080', -1)).toBe('#000000');
  });
  it('leaves "no colour" as no colour', () => {
    expect(shade(TRANSPARENT, 0.5)).toBe(TRANSPARENT);
  });
});

describe('dashArray', () => {
  it('maps known patterns and defaults to solid (null)', () => {
    expect(dashArray('solid')).toBeNull();
    expect(dashArray('dashed')).toEqual([2.4, 1.6]);
    expect(dashArray('does-not-exist')).toBeNull();
  });
});

describe('valuesIn', () => {
  it('returns distinct values, most common first, ignoring blanks', () => {
    const data = fc([
      point(0, 0, { type: 'clinic' }),
      point(1, 1, { type: 'hospital' }),
      point(2, 2, { type: 'clinic' }),
      point(3, 3, { type: '' }),
      point(4, 4, {}),
    ]);
    expect(valuesIn(data, 'type')).toEqual([
      { value: 'clinic', label: 'clinic' },
      { value: 'hospital', label: 'hospital' },
    ]);
  });
  it('honours the limit', () => {
    const data = fc(Array.from({ length: 20 }, (_, i) => point(i, i, { k: `v${i}` })));
    expect(valuesIn(data, 'k', 5)).toHaveLength(5);
  });
});

describe('categorisedSymbology', () => {
  it('assigns a ramp colour to each class and respects an explicit one', () => {
    const sym = categorisedSymbology('type', [
      { value: 'a' },
      { value: 'b', color: '#123456', icon: 'cross', width: 0.8 },
    ], 'risk');
    expect(sym.mode).toBe('categorised');
    expect(sym.categories).toHaveLength(2);
    expect(sym.categories[0].color).toMatch(/^#/);
    expect(sym.categories[1].color).toBe('#123456');
    expect(sym.categories[1].icon).toBe('cross');
    expect(sym.categories[1].width).toBe(0.8);
  });
});

describe('graduatedSymbology', () => {
  it('splits a clean range into the requested number of classes', () => {
    const data = fc(Array.from({ length: 10 }, (_, i) => point(i, 0, { v: i + 1 })));
    const sym = graduatedSymbology(data, 'v', { count: 5, method: 'equal' });
    expect(sym.mode).toBe('graduated');
    expect(sym.classes).toHaveLength(5);
    expect(sym.classes[0].min).toBe(1);
    expect(sym.classes.at(-1).max).toBe(10);
  });

  it('collapses buckets that would repeat the same range', () => {
    const data = fc([1, 1, 1, 1, 10].map((v, i) => point(i, 0, { v })));
    const sym = graduatedSymbology(data, 'v', { count: 5, method: 'quantile' });
    expect(sym.classes.length).toBeLessThan(5);
  });

  it('degrades to a single class when there are no numeric values', () => {
    const sym = graduatedSymbology(fc([point(0, 0, {})]), 'v');
    expect(sym.classes).toHaveLength(1);
  });
});

describe('paintColor', () => {
  it('returns a plain colour for single mode', () => {
    expect(paintColor(singleSymbology('#0369a1'))).toBe('#0369a1');
  });
  it('builds a match expression for categorised mode', () => {
    const sym = categorisedSymbology('type', [{ value: 'a' }, { value: 'b' }], 'risk');
    const expr = paintColor(sym);
    expect(expr[0]).toBe('match');
    expect(expr).toContain('a');
    expect(expr).toContain('b');
  });
  it('builds a step expression for graduated mode', () => {
    const data = fc(Array.from({ length: 10 }, (_, i) => point(i, 0, { v: i })));
    const expr = paintColor(graduatedSymbology(data, 'v'));
    expect(expr[0]).toBe('step');
  });
});

/**
 * The invariant the whole module exists to guarantee: a legend can never show
 * a colour the map is not painting. Both are derived here from one symbology
 * object, so every legend-row colour must appear in the paint expression.
 */
describe('legend ↔ paint parity', () => {
  it('holds for categorised layers', () => {
    const sym = categorisedSymbology('type', [
      { value: 'hospital' }, { value: 'clinic' }, { value: 'pharmacy' },
    ], 'risk');
    const rows = legendRowsFor({ name: 'Health', kind: 'polygon', symbology: sym, style: {} });
    const painted = new Set(colorsIn(paintColor(sym)).map((c) => cssColor(c)));
    for (const row of rows) {
      expect(painted.has(cssColor(row.color))).toBe(true);
    }
  });

  it('holds for graduated layers', () => {
    const data = fc(Array.from({ length: 10 }, (_, i) => point(i, 0, { v: i })));
    const sym = graduatedSymbology(data, 'v', { count: 5, method: 'equal' });
    const rows = legendRowsFor({ name: 'Density', kind: 'polygon', symbology: sym, style: {} });
    const painted = new Set(colorsIn(paintColor(sym)).map((c) => cssColor(c)));
    for (const row of rows) {
      expect(painted.has(cssColor(row.color))).toBe(true);
    }
  });

  it('an edit to a bucket colour moves the painted colour with it', () => {
    const sym = categorisedSymbology('type', [{ value: 'a' }, { value: 'b' }], 'risk');
    const edited = patchBucket(sym, 0, { color: '#ff00ff' });
    expect(colorsIn(paintColor(edited))).toContain('#ff00ff');
    const row = legendRowsFor({ name: 'X', kind: 'polygon', symbology: edited, style: {} })[0];
    expect(row.color).toBe('#ff00ff');
  });
});

describe('legendRowsFor', () => {
  it('shows an outline-only polygon by its stroke colour', () => {
    const rows = legendRowsFor({
      name: 'Boundary', kind: 'polygon',
      symbology: null,
      style: { fillOpacity: 0, stroke: '#b91c1c', fill: '#000000' },
    });
    expect(rows[0].color).toBe('#b91c1c');
  });
  it('gives a line row a weight so hierarchy survives into the key', () => {
    const rows = legendRowsFor({
      name: 'Roads', kind: 'line', symbology: null, style: { widthMm: 0.8 },
    });
    expect(rows[0].width).toBe(0.8);
  });
});

describe('line width in millimetres', () => {
  it('baseWidthOf prefers mm, then converts legacy px, then falls back', () => {
    expect(baseWidthOf({ widthMm: 0.8 })).toBe(0.8);
    expect(baseWidthOf({ width: 3.3 })).toBeCloseTo(1, 5);
    expect(baseWidthOf({ strokeWidth: 6.6 })).toBeCloseTo(2, 5);
    expect(baseWidthOf({})).toBe(DEFAULT_LINE_WIDTH_MM);
  });

  it('lineWidth converts mm to px and enforces a visible hairline floor', () => {
    expect(lineWidth(singleSymbology('#000'), 0.45, 3.3)).toBeCloseTo(1.485, 3);
    expect(lineWidth(singleSymbology('#000'), 0.001, 3.3)).toBe(0.35);   // clamped up
  });

  it('lineWidth returns a per-class match when classes carry their own weights', () => {
    const sym = categorisedSymbology('class', [
      { value: 'trunk', width: 0.8 }, { value: 'service', width: 0.25 },
    ], 'mono');
    const expr = lineWidth(sym, 0.45, 3.3);
    expect(Array.isArray(expr)).toBe(true);
    expect(expr[0]).toBe('match');
  });

  it('swatchStroke stays within its clamp for any weight', () => {
    const size = 13;
    for (const mm of [0.1, 0.45, 1.5, 5]) {
      const s = swatchStroke(size, mm);
      expect(s).toBeGreaterThanOrEqual(size * 0.1 - 1e-9);
      expect(s).toBeLessThanOrEqual(size * 0.6 + 1e-9);
    }
  });
});

describe('dashGroups', () => {
  it('is one unfiltered group when nothing wants a pattern', () => {
    const sym = categorisedSymbology('c', [{ value: 'a' }, { value: 'b' }]);
    expect(dashGroups(sym)).toEqual([{ dash: 'solid', values: null }]);
  });
  it('splits into one group per pattern, plus a rest group', () => {
    const sym = categorisedSymbology('c', [
      { value: 'a', dash: 'dashed' }, { value: 'b' },
    ]);
    const groups = dashGroups(sym);
    expect(groups.some((g) => g.dash === 'dashed' && g.values.includes('a'))).toBe(true);
    expect(groups.some((g) => g.rest)).toBe(true);
  });
});

describe('symbology edits are immutable and correct', () => {
  it('patchCategory touches only the target and returns a new object', () => {
    const sym = categorisedSymbology('c', [{ value: 'a' }, { value: 'b' }]);
    const next = patchCategory(sym, 1, { label: 'Renamed' });
    expect(next).not.toBe(sym);
    expect(sym.categories[1].label).toBe('b');          // original untouched
    expect(next.categories[1].label).toBe('Renamed');
    expect(next.categories[0]).toEqual(sym.categories[0]);
  });

  it('patchClass edits one graduated class', () => {
    const data = fc(Array.from({ length: 6 }, (_, i) => point(i, 0, { v: i })));
    const sym = graduatedSymbology(data, 'v', { count: 3, method: 'equal' });
    const next = patchClass(sym, 0, { label: 'Low' });
    expect(next.classes[0].label).toBe('Low');
    expect(sym.classes[0].label).toBeUndefined();
  });

  it('patchBucket routes row 0 of a single-colour layer to the layer itself', () => {
    const next = patchBucket(singleSymbology('#000'), 0, { color: '#fff' });
    expect(next.color).toBe('#fff');
  });

  it('applyRamp recolours every bucket while keeping the breaks', () => {
    const data = fc(Array.from({ length: 6 }, (_, i) => point(i, 0, { v: i })));
    const sym = graduatedSymbology(data, 'v', { count: 3, method: 'equal' });
    const next = applyRamp(sym, 'viridis');
    expect(next.ramp).toBe('viridis');
    expect(next.classes.map((c) => [c.min, c.max])).toEqual(sym.classes.map((c) => [c.min, c.max]));
    expect(next.classes[0].color).not.toBe(sym.classes[0].color);
  });

  it('reverseRamp flips the colour order', () => {
    const sym = categorisedSymbology('c', [{ value: 'a' }, { value: 'b' }, { value: 'c' }], 'risk');
    const before = sym.categories.map((c) => c.color);
    const after = reverseRamp(sym).categories.map((c) => c.color);
    expect(after).toEqual([...before].reverse());
  });
});
