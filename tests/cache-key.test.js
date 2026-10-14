import { describe, it, expect } from 'vitest';
import {
  CACHE_VERSION, hash, round, normBbox, bboxKey, entryKey, familyKey,
  bboxArea, contains, intersects, geometryBbox, narrowToBbox,
} from '../src/data/cache/key.js';
import { fc, point, line, square } from './fixtures.js';

describe('hash', () => {
  it('is deterministic for the same input', () => {
    expect(hash('roads-major')).toBe(hash('roads-major'));
  });
  it('separates different inputs', () => {
    expect(hash('abc')).not.toBe(hash('abd'));
  });
  it('returns a non-empty base36 string', () => {
    expect(hash('anything')).toMatch(/^[0-9a-z]+$/);
  });
});

describe('coordinate rounding', () => {
  it('rounds to ~1 m (5 decimal places)', () => {
    expect(round(1.2345678)).toBe(1.23457);
  });
  it('normBbox rounds every ordinate', () => {
    expect(normBbox([1.111119, 2.0, 3.0, 4.0])).toEqual([1.11112, 2, 3, 4]);
  });
  it('bboxKey joins the normalised ordinates', () => {
    expect(bboxKey([1, 2, 3, 4])).toBe('1,2,3,4');
  });
});

describe('identity keys', () => {
  const entry = { provider: 'osm', dataset: 'health', variant: 'v1', bbox: [1, 2, 3, 4] };

  it('entryKey carries version, identity and extent', () => {
    expect(entryKey(entry)).toBe(`${CACHE_VERSION}|osm|health|v1|1,2,3,4`);
  });
  it('familyKey is the entry key without the bbox', () => {
    expect(familyKey(entry)).toBe(`${CACHE_VERSION}|osm|health|v1`);
  });
  it('a changed variant produces a different family — stale rows stop matching', () => {
    expect(familyKey({ ...entry, variant: 'v2' })).not.toBe(familyKey(entry));
  });
  it('defaults the variant to empty when absent', () => {
    expect(entryKey({ provider: 'osm', dataset: 'roads', bbox: [0, 0, 1, 1] }))
      .toBe(`${CACHE_VERSION}|osm|roads||0,0,1,1`);
  });
});

describe('extent maths', () => {
  it('bboxArea is width × height', () => {
    expect(bboxArea([0, 0, 2, 3])).toBe(6);
  });

  it('contains is true only when outer fully covers inner', () => {
    expect(contains([0, 0, 10, 10], [1, 1, 2, 2])).toBe(true);
    expect(contains([0, 0, 10, 10], [0, 0, 10, 10])).toBe(true);     // equal counts
    expect(contains([0, 0, 2, 2], [1, 1, 3, 3])).toBe(false);        // spills east/north
  });

  it('intersects is true for any overlap and false when disjoint', () => {
    expect(intersects([0, 0, 2, 2], [1, 1, 3, 3])).toBe(true);
    expect(intersects([0, 0, 1, 1], [2, 2, 3, 3])).toBe(false);
  });
});

describe('geometryBbox', () => {
  it('handles a bare point', () => {
    expect(geometryBbox(point(3, 6).geometry)).toEqual([3, 6, 3, 6]);
  });
  it('handles a line', () => {
    expect(geometryBbox(line([[0, 0], [2, 3]]).geometry)).toEqual([0, 0, 2, 3]);
  });
  it('handles a polygon', () => {
    expect(geometryBbox(square(0, 0, 1).geometry)).toEqual([-1, -1, 1, 1]);
  });
  it('spans a GeometryCollection', () => {
    const gc = { type: 'GeometryCollection', geometries: [point(0, 0).geometry, point(5, 4).geometry] };
    expect(geometryBbox(gc)).toEqual([0, 0, 5, 4]);
  });
  it('returns null for nothing', () => {
    expect(geometryBbox(null)).toBeNull();
  });
});

describe('narrowToBbox', () => {
  it('keeps only features whose own extent meets the requested one', () => {
    const data = fc([point(0.5, 0.5, { keep: true }), point(5, 5, { keep: false })]);
    const narrowed = narrowToBbox(data, [0, 0, 1, 1]);
    expect(narrowed.features).toHaveLength(1);
    expect(narrowed.features[0].properties.keep).toBe(true);
  });
  it('matches Overpass behaviour — a feature touching the edge is kept whole', () => {
    // A line crossing out of the box still intersects it, so it survives.
    const data = fc([line([[0.5, 0.5], [9, 9]])]);
    expect(narrowToBbox(data, [0, 0, 1, 1]).features).toHaveLength(1);
  });
});
