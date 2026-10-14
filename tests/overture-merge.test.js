import { describe, it, expect } from 'vitest';
import { SUPPLEMENTS, supplementFor } from '../src/data/overture-merge.js';

describe('supplementFor', () => {
  it('returns a supplement for a known dataset slug', () => {
    const health = supplementFor('health');
    expect(health).toBeTruthy();
    expect(health.theme).toBe('places');
    expect(typeof health.tags).toBe('function');
  });
  it('returns null for an unknown slug', () => {
    expect(supplementFor('not-a-dataset')).toBeNull();
  });
  it('every supplement declares the fields the client needs', () => {
    for (const [slug, s] of Object.entries(SUPPLEMENTS)) {
      expect(s.id, slug).toBe(slug);
      expect(s.theme, slug).toBeTruthy();
      expect(typeof s.tags, slug).toBe('function');
      expect(s.minZoom, slug).toBeLessThanOrEqual(s.maxZoom);
    }
  });
});

describe('Overture → OSM tag translation', () => {
  it('maps health places to OSM amenity tags by category', () => {
    const tags = (info) => supplementFor('health').tags(info);
    expect(tags({ group: 'health', category: 'hospital' })).toEqual({ amenity: 'hospital' });
    expect(tags({ group: 'health', category: 'pharmacy' })).toEqual({ amenity: 'pharmacy' });
    expect(tags({ group: 'health', category: 'dental clinic' })).toEqual({ amenity: 'dentist' });
  });

  it('narrows a theme to its subject by group — a food place is not health', () => {
    expect(supplementFor('health').tags({ group: 'food', category: 'hospital' })).toBeNull();
  });

  it('falls back to a sensible default inside the right group', () => {
    // An in-group category that matches no rule still becomes the fallback.
    expect(supplementFor('health').tags({ group: 'health', category: 'wellness spa' }))
      .toEqual({ amenity: 'clinic' });
  });

  it('keeps roads-major to its declared classes and excludes motorway', () => {
    const tags = (info) => supplementFor('roads-major').tags(info);
    expect(tags({ subtype: 'road', class: 'primary' })).toEqual({ highway: 'primary' });
    expect(tags({ subtype: 'road', class: 'trunk' })).toEqual({ highway: 'trunk' });
    expect(tags({ subtype: 'road', class: 'motorway' })).toBeNull();   // deliberately excluded
    expect(tags({ subtype: 'rail', class: 'primary' })).toBeNull();    // wrong subtype
  });

  it('splits roads-major and roads-local on class', () => {
    expect(supplementFor('roads-local').tags({ subtype: 'road', class: 'residential' }))
      .toEqual({ highway: 'residential' });
    expect(supplementFor('roads-local').tags({ subtype: 'road', class: 'primary' })).toBeNull();
  });

  it('tags railways from the rail subtype', () => {
    expect(supplementFor('railways').tags({ subtype: 'rail' })).toEqual({ railway: 'rail' });
    expect(supplementFor('railways').tags({ subtype: 'road' })).toBeNull();
  });

  it('reads a river from class and a canal from subtype', () => {
    const tags = (info) => supplementFor('rivers').tags(info);
    expect(tags({ class: 'river', subtype: 'water' })).toEqual({ waterway: 'river' });
    expect(tags({ class: 'water', subtype: 'canal' })).toEqual({ waterway: 'canal' });
  });

  it('classifies worship by religion from the cultural group', () => {
    const tags = (info) => supplementFor('worship').tags(info);
    expect(tags({ group: 'cultural', category: 'mosque' }))
      .toEqual({ amenity: 'place_of_worship', religion: 'muslim' });
    expect(tags({ group: 'cultural', category: 'baptist church' }))
      .toEqual({ amenity: 'place_of_worship', religion: 'christian' });
    expect(tags({ group: 'food', category: 'mosque' })).toBeNull();
  });

  it('tags every building unconditionally', () => {
    expect(supplementFor('buildings').tags({})).toEqual({ building: 'yes' });
  });
});
