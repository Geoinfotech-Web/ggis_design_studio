import { describe, it, expect } from 'vitest';
import { TOOLS, TOOL_CATEGORIES } from '../src/analysis/tools.js';
import { layer, point, line, square } from './fixtures.js';

const tool = (id) => {
  const t = TOOLS.find((x) => x.id === id);
  if (!t) throw new Error(`no such tool: ${id}`);
  return t;
};
const statVal = (result, label) => result.stats.find((s) => s.label === label)?.value;

describe('tool catalogue', () => {
  it('every tool is complete and points at a declared category', () => {
    const categories = new Set(TOOL_CATEGORIES.map((c) => c.id));
    for (const t of TOOLS) {
      expect(categories.has(t.category), t.id).toBe(true);
      expect(typeof t.run, t.id).toBe('function');
      expect(['polygon', 'line', 'point'], t.id).toContain(t.kind);
    }
  });
});

describe('buffer zone', () => {
  it('draws one polygon zone per feature', () => {
    const src = layer('Clinics', 'point', [point(3.4, 6.5), point(3.5, 6.6)]);
    const result = tool('buffer').run({ layers: { layer: src }, params: { distance: 1 } });
    expect(result.kind).toBe('polygon');
    expect(result.geojson.features).toHaveLength(2);
    expect(statVal(result, 'Zones drawn')).toBe('2');
    expect(result.geojson.features[0].properties.buffer_km).toBe(1);
  });
});

describe('nearest facility', () => {
  it('joins each origin to its closest target and measures the distance', () => {
    const from = layer('Homes', 'point', [point(3.40, 6.5), point(3.42, 6.5)]);
    const to = layer('Clinics', 'point', [point(3.41, 6.5)]);
    const result = tool('nearest').run({ layers: { from, to } });
    expect(result.kind).toBe('line');
    expect(result.geojson.features).toHaveLength(2);
    expect(statVal(result, 'Connections')).toBe('2');
    for (const f of result.geojson.features) {
      expect(f.properties.distance_km).toBeGreaterThanOrEqual(0);
    }
  });

  it('refuses when the target layer has no features', () => {
    const from = layer('Homes', 'point', [point(0, 0)]);
    const to = layer('Clinics', 'point', []);
    expect(() => tool('nearest').run({ layers: { from, to } })).toThrow();
  });
});

describe('clip to boundary', () => {
  it('keeps only the points inside the boundary', () => {
    const src = layer('Points', 'point', [point(0, 0, { in: true }), point(5, 5, { in: false })]);
    const boundary = layer('Area', 'polygon', [square(0, 0, 1)]);
    const result = tool('clip').run({ layers: { layer: src, boundary }, area: null });
    expect(result.geojson.features).toHaveLength(1);
    expect(statVal(result, 'Kept')).toBe('1');
    expect(statVal(result, 'Removed')).toBe('1');
  });
});

describe('count inside areas', () => {
  it('counts points per polygon and shades by the result', () => {
    const points = layer('Schools', 'point', [point(0, 0), point(0.5, 0.5), point(9, 9)]);
    const areas = layer('Wards', 'polygon', [square(0, 0, 1)]);
    const result = tool('count-in').run({ layers: { points, areas }, area: null });
    expect(result.geojson.features).toHaveLength(1);
    expect(result.geojson.features[0].properties.count).toBe(2);   // two of three fall inside
    expect(statVal(result, 'Busiest area holds')).toBe('2');
  });
});

describe('calculate area', () => {
  it('measures each polygon and tags it with area_km2', () => {
    const src = layer('Parcels', 'polygon', [square(0, 0, 1), square(10, 10, 0.5)]);
    const result = tool('area').run({ layers: { layer: src } });
    expect(result.geojson.features).toHaveLength(2);
    expect(statVal(result, 'Features measured')).toBe('2');
    for (const f of result.geojson.features) {
      expect(f.properties.area_km2).toBeGreaterThan(0);
    }
  });

  it('refuses a layer with no polygons', () => {
    const src = layer('Points', 'point', [point(0, 0)]);
    expect(() => tool('area').run({ layers: { layer: src } })).toThrow();
  });
});

describe('measure network', () => {
  it('totals line length and tags each segment', () => {
    const src = layer('Roads', 'line', [
      line([[0, 0], [1, 0]], { gds_class: 'primary' }),
      line([[0, 1], [0.5, 1]], { gds_class: 'primary' }),
    ]);
    const result = tool('length').run({ layers: { layer: src }, studyAreaKm2: 0 });
    expect(result.kind).toBe('line');
    expect(statVal(result, 'Segments')).toBe('2');
    for (const f of result.geojson.features) {
      expect(f.properties.length_km).toBeGreaterThan(0);
    }
  });
});

describe('estimate volume', () => {
  it('multiplies each polygon area by the supplied depth', () => {
    const src = layer('Ponds', 'polygon', [square(0, 0, 0.1)]);
    const result = tool('volume').run({ layers: { layer: src }, params: { depth: 2 } });
    const f = result.geojson.features[0];
    expect(f.properties.depth_m).toBe(2);
    expect(f.properties.volume_m3).toBeGreaterThan(0);
  });
});
