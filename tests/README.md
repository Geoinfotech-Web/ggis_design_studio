# Tests

A [Vitest](https://vitest.dev) suite over the app's **pure logic** — the code
whose correctness is easy to break silently and hard to see in the UI. It runs
in a plain Node environment: no DOM, no map, no network.

```bash
npm test          # watch mode
npm run test:run  # one-shot (CI)
npm run coverage  # one-shot + coverage report (coverage/index.html)
```

## What is covered, and why these first

| File | Module under test | The invariant it guards |
|------|-------------------|-------------------------|
| `cache-key.test.js` | [`src/data/cache/key.js`](../src/data/cache/key.js) | Cache identity and **containment** — a stale variant stops matching; a stored extent answers only requests it fully covers; `narrowToBbox` keeps a hit indistinguishable from a live fetch. |
| `geo.test.js` | [`src/core/geo.js`](../src/core/geo.js) | Geodesy and clipping — `combinedAreaKm2` **dissolves** overlapping areas instead of summing them; `clipToArea` trims lines at the boundary; formatting (`formatDMS`, `formatArea`). |
| `symbology.test.js` | [`src/layers/symbology.js`](../src/layers/symbology.js) | **Legend ↔ paint parity**: every legend-row colour appears in the map paint expression, so a legend can never show a colour the map is not drawing. Plus graduated classing, mm line widths, and immutable edits. |
| `overture-merge.test.js` | [`src/data/overture-merge.js`](../src/data/overture-merge.js) | The Overture → OpenStreetMap tag translation — a feature reaches the classifier indistinguishable from an Overpass one, and each theme is narrowed to its subject. |
| `analysis.test.js` | [`src/analysis/tools.js`](../src/analysis/tools.js) | Each geoprocessing tool computes for real — buffers, nearest-facility distances, clip/count/area/length/volume — on fixture layers. |

## Conventions

- GeoJSON fixtures come from [`fixtures.js`](./fixtures.js) (`point`, `line`,
  `square`, `layer`). Coordinates are kept near the equator and simple; Turf
  does the real geodesy.
- Formatting assertions strip locale thousands-separators so they survive any
  ICU locale (see `digits()` in `geo.test.js`).

## Good next targets

Not yet covered, and worth adding as the logic settles:

- `src/data/study-areas.js` — the `studyAreas` → `studyArea` combined-view
  write, the one place two state keys must never disagree.
- `src/templates/apply.js` — `applyTemplate()` producing the documented
  opening position for each template id.
- `src/layout/derive.js` — derived element content (scale bar, key figures)
  staying correct as data and camera change.
