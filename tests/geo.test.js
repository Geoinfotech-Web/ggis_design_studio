import { describe, it, expect } from 'vitest';
import {
  areaKm2, combinedAreaKm2, bboxOf, centroidOf, boundsFromBbox,
  metresPerPixel, niceScaleBar, formatNumber, formatArea, formatDMS,
  dominantGeometry, featureCount, bboxToOverpass, pointInGeoJson, clipToArea,
} from '../src/core/geo.js';
import { fc, point, line, square } from './fixtures.js';

/** Strip locale thousands separators so assertions survive any ICU locale. */
const digits = (s) => s.replace(/[^\d.]/g, '');

describe('areaKm2', () => {
  it('measures a polygon and tolerates junk', () => {
    expect(areaKm2(square(0, 0, 1))).toBeGreaterThan(0);
    expect(areaKm2(null)).toBe(0);
  });
});

describe('combinedAreaKm2', () => {
  it('equals the single area for one polygon', () => {
    const one = square(3.4, 6.5, 0.1);
    expect(combinedAreaKm2([fc([one])])).toBeCloseTo(areaKm2(one), 5);
  });

  it('dissolves overlapping areas instead of summing them', () => {
    const a = square(3.40, 6.5, 0.1);
    const b = square(3.45, 6.5, 0.1);          // overlaps the eastern half of a
    const single = areaKm2(a);
    const combined = combinedAreaKm2([fc([a]), fc([b])]);
    const plainSum = areaKm2(a) + areaKm2(b);
    // The union must be clearly less than the arithmetic sum (shared ground
    // counted once) yet clearly more than a single square.
    expect(combined).toBeLessThan(plainSum * 0.95);
    expect(combined).toBeGreaterThan(single * 1.1);
  });

  it('is zero when there are no polygons', () => {
    expect(combinedAreaKm2([fc([point(0, 0)])])).toBe(0);
    expect(combinedAreaKm2([])).toBe(0);
  });
});

describe('bbox / centroid / bounds', () => {
  it('bboxOf returns [w,s,e,n]', () => {
    expect(bboxOf(square(0, 0, 2))).toEqual([-2, -2, 2, 2]);
  });
  it('centroidOf lands in the middle', () => {
    const [lng, lat] = centroidOf(square(3, 4, 1));
    expect(lng).toBeCloseTo(3, 5);
    expect(lat).toBeCloseTo(4, 5);
  });
  it('boundsFromBbox nests into MapLibre corner pairs', () => {
    expect(boundsFromBbox([1, 2, 3, 4])).toEqual([[1, 2], [3, 4]]);
    expect(boundsFromBbox(null)).toBeNull();
  });
});

describe('scale helpers', () => {
  it('metresPerPixel shrinks as zoom grows', () => {
    expect(metresPerPixel(0, 10)).toBeGreaterThan(metresPerPixel(0, 12));
  });

  it('niceScaleBar picks a 1/2/2.5/5 ×10ⁿ value that fits', () => {
    const bar = niceScaleBar(100, 10);        // up to 1000 m available
    expect([1, 2, 2.5, 5].some((s) => bar.metres === s * Math.pow(10, Math.floor(Math.log10(1000)))))
      .toBe(true);
    expect(bar.metres).toBeLessThanOrEqual(1000);
    expect(bar.px).toBeLessThanOrEqual(100);
  });

  it('niceScaleBar switches to km past 1000 m', () => {
    expect(niceScaleBar(500, 20).label).toMatch(/km$/);
  });
});

describe('number & unit formatting', () => {
  it('formatNumber keeps the digits (locale-independent check)', () => {
    expect(digits(formatNumber(1234, 0))).toBe('1234');
    expect(formatNumber(5)).toBe('5');
  });
  it('formatNumber returns an em dash for non-finite input', () => {
    expect(formatNumber(Infinity)).toBe('—');
  });
  it('formatArea uses m² below half a km² and km² above', () => {
    expect(formatArea(0.1)).toMatch(/m²$/);
    expect(formatArea(0.1)).not.toMatch(/km²$/);
    expect(formatArea(28765)).toMatch(/km²$/);
    expect(formatArea(0)).toBe('—');
  });
  it('formatDMS matches the documented worked example', () => {
    expect(formatDMS(7.4951, 'lng')).toBe('7°29′42″E');
    expect(formatDMS(-1.5, 'lng')).toMatch(/W$/);
    expect(formatDMS(9.0579, 'lat')).toMatch(/N$/);
  });
});

describe('geometry summaries', () => {
  it('dominantGeometry reports the most common type', () => {
    expect(dominantGeometry(fc([point(0, 0), point(1, 1), line([[0, 0], [1, 1]])]))).toBe('point');
    expect(dominantGeometry(fc([square(0, 0, 1)]))).toBe('polygon');
  });
  it('featureCount tolerates a bare geometry', () => {
    expect(featureCount(fc([point(0, 0), point(1, 1)]))).toBe(2);
    expect(featureCount(point(0, 0))).toBe(1);
    expect(featureCount(null)).toBe(0);
  });
  it('bboxToOverpass reorders [w,s,e,n] to s,w,n,e', () => {
    expect(bboxToOverpass([1, 2, 3, 4])).toBe('2,1,4,3');
  });
});

describe('pointInGeoJson', () => {
  const box = fc([square(0, 0, 1)]);
  it('is true inside and false outside', () => {
    expect(pointInGeoJson([0, 0], box)).toBe(true);
    expect(pointInGeoJson([5, 5], box)).toBe(false);
  });
  it('treats a missing boundary as "everywhere inside"', () => {
    expect(pointInGeoJson([99, 99], null)).toBe(true);
  });
});

describe('clipToArea', () => {
  const area = square(0, 0, 1);

  it('drops points outside the boundary and keeps those inside', () => {
    const data = fc([point(0, 0, { in: true }), point(5, 5, { in: false })]);
    const clipped = clipToArea(data, area);
    expect(clipped.features).toHaveLength(1);
    expect(clipped.features[0].properties.in).toBe(true);
  });

  it('returns a line that crosses the boundary, trimmed to the inside', () => {
    const data = fc([line([[0, 0], [5, 0]])]);     // starts inside, runs out east
    const clipped = clipToArea(data, area);
    expect(clipped.features).toHaveLength(1);
    const coords = clipped.features[0].geometry.coordinates.flat(Infinity);
    const maxX = Math.max(...coords.filter((_, i) => i % 2 === 0));
    expect(maxX).toBeLessThanOrEqual(1.0001);       // cut at the eastern edge
  });

  it('returns the input untouched when the area has no polygon', () => {
    const data = fc([point(9, 9)]);
    expect(clipToArea(data, fc([point(0, 0)]))).toBe(data);
  });
});
