/**
 * Small GeoJSON builders shared across the suite.
 *
 * Coordinates are kept simple and near the equator so a degree is roughly a
 * degree in both axes — these tests check logic, not cartographic precision,
 * and Turf does the real geodesy.
 */

export const fc = (features) => ({ type: 'FeatureCollection', features });

export const point = (lng, lat, properties = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties,
});

export const line = (coords, properties = {}) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: coords },
  properties,
});

/** An axis-aligned square polygon centred on (cx, cy) with the given half-size. */
export const square = (cx, cy, half, properties = {}) => ({
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [cx - half, cy - half],
      [cx + half, cy - half],
      [cx + half, cy + half],
      [cx - half, cy + half],
      [cx - half, cy - half],
    ]],
  },
  properties,
});

/** A layer object in the shape the analysis tools expect. */
export const layer = (name, kind, features, extra = {}) => ({
  name,
  kind,
  geojson: fc(features),
  ...extra,
});
