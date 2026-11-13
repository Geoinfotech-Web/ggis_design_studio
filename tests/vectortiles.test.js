import { describe, it, expect } from 'vitest';
import { osmTagsFor, tileZoomFor, hasTileSource } from '../src/data/vectortiles.js';
import { compileQuery } from '../server/ql.js';
import { OSM_DATASETS } from '../src/data/osm-catalog.js';
import { classify } from '../src/data/catalog.js';

const dataset = (slug) => OSM_DATASETS.find((d) => d.slug === slug);

describe('osmTagsFor — OpenMapTiles back to OpenStreetMap tags', () => {
  it('turns road classes into highway tags the catalogue queries match', () => {
    const tags = osmTagsFor('transportation', { class: 'primary', name: 'Ikorodu Road' });
    expect(tags).toEqual({ highway: 'primary', name: 'Ikorodu Road' });
    expect(compileQuery(dataset('roads-major').body).match('way', tags)).toBe(true);
    expect(classify(dataset('roads-major'), tags)).toBe('Primary');
  });

  it('maps minor roads, railways, bridges and ferries', () => {
    expect(osmTagsFor('transportation', { class: 'minor' }).highway).toBe('residential');
    expect(osmTagsFor('transportation', { class: 'rail', subclass: 'rail' }).railway).toBe('rail');
    expect(osmTagsFor('transportation', { class: 'secondary', brunnel: 'bridge' }).bridge).toBe('yes');
    expect(osmTagsFor('transportation', { class: 'ferry' }).route).toBe('ferry');
  });

  it('gives points of interest the right key, so health and schools are found', () => {
    const hospital = osmTagsFor('poi', { class: 'hospital', subclass: 'hospital', name: 'LASUTH' });
    expect(hospital.amenity).toBe('hospital');
    expect(compileQuery(dataset('health').body).match('node', hospital)).toBe(true);
    expect(osmTagsFor('poi', { class: 'lodging', subclass: 'hotel' }).tourism).toBe('hotel');
  });

  it('drops what has no OpenStreetMap equivalent here', () => {
    expect(osmTagsFor('water', { class: 'ocean' })).toBeNull();
    expect(osmTagsFor('place', { class: 'country' })).toBeNull();
    expect(osmTagsFor('housenumber', {})).toBeNull();
  });
});

describe('tileZoomFor — the most detailed zoom that fits the budget', () => {
  it('reads a state at a detailed zoom', () => {
    expect(tileZoomFor(dataset('roads-major'), [3.0, 6.3, 4.4, 6.8])).toBeGreaterThanOrEqual(10);
  });

  it('can read major roads for a whole country, but not points of interest', () => {
    const ghana = [-3.26, 4.74, 1.2, 11.17];
    expect(tileZoomFor(dataset('roads-major'), ghana)).toBe(9);
    expect(tileZoomFor(dataset('health'), ghana)).toBeNull();
  });

  it('knows which datasets the tiles cannot carry', () => {
    expect(hasTileSource(dataset('railways'))).toBe(true);
    expect(hasTileSource(dataset('power'))).toBe(false);
  });
});
