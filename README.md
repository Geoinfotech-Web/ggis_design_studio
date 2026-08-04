# GIS Design Studio — v3

Template-based map design for people who are not GIS specialists. Pick a
cartographic style, choose your study area, drop in open data, run the
satellite analysis you need, drag the title and legend where you want them,
and export a print-ready PDF or PNG.

Design system carried over from the team's Flood Watch interface
(<https://gfw.ggis.africa>): sky/slate palette, glass surfaces, Source Sans 3
+ Fraunces.

## Run it

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. `npm run build` produces a static `dist/`
that can be served from anywhere.

Needs an internet connection: basemap tiles come from
[OpenFreeMap](https://openfreemap.org), boundaries from
[Nominatim](https://nominatim.org), feature data from the
[Overpass API](https://overpass-api.de). All three are free and key-less.

## What it does

**18 templates**, in seven families — cartographic, report, analysis,
artistic, vintage, topographic, 3-D and editorial. A template is a complete
opening position: basemap, look filter, page size, and every element already
placed. Everything stays editable afterwards.

**Study areas.** Search a country, state, LGA, city or any named place. The
real administrative outline is fetched from OpenStreetMap, drawn on the map,
and becomes the region every data fetch and analysis job works inside.

**Open data.** Twenty-one OpenStreetMap datasets described in plain English —
major roads, rivers, health facilities, oil and gas infrastructure, land use
and so on. Or bring your own GeoJSON, KML, KMZ, GPX, CSV or zipped Shapefile;
files are parsed in the browser and never uploaded.

**Analysis.** Eight Earth-observation jobs chosen by the question they answer:
land cover, vegetation health, oil-spill detection, flood extent, built-up
expansion, land surface temperature, water turbidity, erosion susceptibility.

**Editable map elements.** Title, subtitle, free text, legend, key figures,
map information, credits, north arrow, scale bar, locator inset, logo and
neatline. Drag them anywhere inside the page frame, with snap guides to the
page and to each other. The legend, key figures, map information and scale
bar read the live document, so they stay correct as data and analysis change.

**Export.** PNG or single-page PDF at the exact paper size, at 96, 150 or
300 dpi. The export crops the live map to the page frame, re-applies the
template's look filter and paper texture, and repaints every element with
canvas renderers that mirror the on-screen ones.

## Real vs. demonstration data

Everything above is real except the analysis numbers.

Earth Engine cannot be called from a browser — it needs a service-account
key and server-side evaluation. So the studio ships two analysis providers:

- **Demo engine (default, offline).** Generates deterministic, plausible
  results so the whole workflow can be designed, styled and exported without
  credentials. Every layer and legend it produces is tagged `synthetic: true`
  and labelled as demonstration data in the UI and on the printed credits.
- **Google Earth Engine.** Point `Analysis → Engine settings` at your own
  backend URL and the same jobs run for real. The request/response contract
  and a reference Node implementation are documented at the top of
  [`src/analysis/gee-provider.js`](src/analysis/gee-provider.js). That backend
  is the only piece you have to write.

Study-area figures are approximate: they are computed from the mapped outline,
not from a survey.

## How the code is arranged

```
src/
├── main.js              entry point; landing ⇄ studio, boot order
├── core/                constants, DOM helpers, geo maths, map controller,
│                        store (state + pub/sub + undo + persistence), toasts
├── data/                Nominatim boundaries, OSM catalogue, Overpass client,
│                        browser-side file parsing
├── layers/              registry (one ordered list of everything drawn) and
│                        render (projects the registry onto MapLibre)
├── analysis/            job catalogue, provider interface, demo + GEE providers
├── templates/           the 18-template catalogue and applyTemplate()
├── layout/              element catalogue (screen + canvas renderers),
│                        derived content, canvas drawing primitives
├── export/              crop, filter, texture and element compositing
├── ui/                  landing, studio chrome, artboard interaction,
│                        inspector, and one module per left-hand panel
└── styles/              base tokens, landing, studio, CSS template thumbnails
```

Two rules hold the thing together:

1. **Modules never call each other directly.** They `set()` state and
   `subscribe()` to the keys they care about. That is what keeps the panels,
   the map and the export from drifting apart the way they did in the v2
   prototype (kept for reference in [`legacy/`](legacy/v2-prototype.html)).
2. **Every element type is defined once**, in
   [`src/layout/elements.js`](src/layout/elements.js), with its screen
   renderer and its canvas renderer side by side. What you drag is what
   prints.

## Attribution

Basemap © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors ·
Boundaries via Nominatim · Feature data © OpenStreetMap contributors.

The public Nominatim and Overpass endpoints are shared community services.
Calls are throttled, cached and size-capped here, which is fine for demo and
internal use; a production deployment should point `ENDPOINTS` in
[`src/core/constants.js`](src/core/constants.js) at self-hosted instances or a
commercial provider.
