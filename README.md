# GIS Design Studio — v3

Template-based map design for people who are not GIS specialists. Pick a
cartographic style, choose your study area, drop in open data, run the
analysis you need, drag the title and legend where you want them, and export
a print-ready PDF or PNG.

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

Optionally, alongside it:

```bash
npm run cache
```

That starts the [geodata cache](#the-geodata-cache) — a local database that
remembers every OpenStreetMap and Overture download so the same area is never
fetched twice. It is not required; without it the studio works exactly as
before, just slower on repeat areas.

## What it does

**18 templates**, in seven families — cartographic, report, analysis,
artistic, vintage, topographic, 3-D and editorial. A template is a complete
opening position: basemap, look filter, page size, and every element already
placed. Everything stays editable afterwards.

**Study areas.** Search a country, state, LGA, city or any named place. The
real administrative outline is fetched from OpenStreetMap, drawn on the map,
and becomes the region every data fetch and analysis job works inside.

**Open data, segmented.** Thirty-nine datasets described in plain English,
across roads and transport, water and nature, buildings and places, services
and facilities, land use, and industry and hazard.

**Two providers, one layer.** Thirty-four of those datasets pull from
**OpenStreetMap and Overture Maps together** and return a single layer. There
is no Overture section to browse, because someone looking for hospitals wants
hospitals, not a decision about data providers first. Adding *Health
facilities* to Ikeja fetches both, and OpenStreetMap's 15 facilities become
244 after Overture's contribution is merged and clipped. Adding *Building
footprints* to a ward-sized area turns OpenStreetMap's 1,389 buildings into
9,254 — 7,685 of them Google footprints that OpenStreetMap has never mapped.

This works because Overture is translated into OpenStreetMap's tag vocabulary
before anything else sees it — an Overture road with `class: "motorway"`
becomes `highway: "motorway"`, an Overture place categorised "dental clinic"
becomes `amenity: "dentist"`. By the time a feature reaches the classifier it
is indistinguishable from an Overpass one, so **the existing OpenStreetMap
segment rules, colours, symbols and legend rows apply to it unchanged**, and
it is clipped to the study area exactly as an OpenStreetMap-only layer is.

Overture *contains* OpenStreetMap, so a plain concatenation would show most
features twice. Duplicates go in two passes, most certain first: Overture
records which project each feature's geometry came from, so anything credited
to OpenStreetMap is dropped outright — 11,327 of them in that buildings
example, exactly, not heuristically. Then a same-named point within 40 m of an
OpenStreetMap one is treated as the same place, and the OpenStreetMap version
kept, because it has the richer tags. Both providers keep a `gds_source`
property, so *Colour by category → gds_source* gives you the
Google / Microsoft / OpenStreetMap split whenever you want to see it.

Overture publishes releases as GeoParquet, which a browser cannot query, so
supplements are read from Overture's own PMTiles archives over HTTP range
requests — a few hundred kilobytes at a time, decoded in the page and stitched
back into whole features. Two honest consequences: geometry is tile-clipped
(pieces are re-joined by their stable Overture id, and the copies that tile
buffers produce are discarded), and it is generalised for the zoom it was cut
at. Each supplement declares the lowest zoom at which its data is still
complete — measured, not guessed, because the places layer does not exist
below zoom 14 and buildings lose 95% of themselves by zoom 12. Overture is
always a supplement, never a requirement: if it is unavailable or the area is
too large for it, the dataset is still the dataset, from OpenStreetMap alone.

Thirty-one of them come in meaningful types and arrive already split: roads
by class (trunk, primary, secondary, then tertiary,
residential, service and track), health facilities by kind (hospital, clinic,
doctor, pharmacy, dentist), schools by level, airports by part, places of
worship by religion, banks, government offices, hotels, food, sport, culture,
waste, power and oil & gas. Each arrives with a categorised symbology and one
legend row per type instead of a single undifferentiated colour.

Point types arrive with a **symbol**, not a dot: a cross on hospitals, a pill
on pharmacies, a mortar-board on universities, a plane on aerodromes. Line
types arrive with the **pattern** the subject deserves — a track dashed, a
ferry route dashed because it is a crossing rather than a road, a pipeline in
long dashes, a distribution line lighter than a transmission line. All of it
is a starting position; everything stays editable.

Or bring your own GeoJSON, KML, KMZ, GPX, CSV or zipped Shapefile; files are
parsed in the browser and never uploaded.

**Analysis that actually computes.** Eight tools, chosen by the question they
answer, all running locally on the layers already on your map — no engine to
configure, no credentials, no simulated numbers:

| Distance & proximity | Overlay & selection | Measurement | Patterns |
|---|---|---|---|
| Buffer zone | Clip to boundary | Calculate area | Hotspot map |
| Nearest facility | Count inside areas | Measure network | |
| | | Estimate volume | |

Areas and lengths are measured on the ellipsoid, distances are straight-line,
and volume is area × a depth you supply. Each tool says so in its own summary
and on the printed credits line.

**Editable map elements.** Title, subtitle, free text, legend, key figures,
map information, credits, north arrow, scale bar, locator inset, logo and
neatline. Drag them anywhere inside the page frame, with snap guides to the
page and to each other. The legend, key figures, map information and scale
bar read the live document, so they stay correct as data and analysis change.

**Alignment.** Two ways, depending on whether you are placing one thing or
tidying several:

- *Arrange* (right-hand panel, with an element selected) — a nine-square
  placement grid drops the element onto any corner, edge or the centre of the
  page; six align buttons do the same one axis at a time; fill width/height
  stretches it across the page. A margin slider sets how far in from the edge
  "left" and "right" mean.
- *Align* (Elements panel) — tick two or more elements to line them up left,
  centre, right, top, middle or bottom, either against the page or against
  each other. Three or more can be spread with equal gaps or matched in size.

**Symbology.** Every vector layer can be coloured three ways — a single
colour, by category (a text field, one colour per value), or graduated (a
numeric field split into classes by even counts or even steps). Seven preset
ramps, reversible, with a colour picker per bucket.

**44 point symbols**, in eight groups — health, education, transport, civic
and safety, shops and services, utilities and industry, nature and leisure,
plus plain shapes. Pick one for a whole layer, or a different one for each
class, so hospitals and pharmacies are told apart by shape and not only by
colour. Each symbol is one SVG path rendered three ways — as a map sprite, as
a legend swatch, and into the export canvas — so the printed key is the mark
the map is drawing.

**Six line patterns** — solid, dashed, dotted, dash-dot, long dash, fine dash
— per layer or per class. `line-dasharray` is the one line property MapLibre
will not evaluate per feature, so a layer whose classes want different
patterns quietly becomes several filtered map layers; the panel just shows
one line per class.

**An editable legend.** Select the legend on the page and every row is there
to edit: its colour, its symbol, its line pattern, and the words beside it.
Rename *Primary* to "Primary highway", give hospitals a different colour, put
a dashed line on proposed roads.

**No colour at all**, as a colour. Every swatch in the legend, the layer
styling and the shape tools can be emptied — the cartographic "no brush", not
a colour that happens to be invisible. Emptying a polygon's fill leaves its
outline alone, which is how you draw a boundary you want to see through, and
the legend answers with a hollow swatch on screen and in the PDF.

**Legends that cannot lie.** Editing a legend row is not writing into the
legend — there is nothing there to write into. The rows are generated from
each layer's symbology, which is also what paints the map, so an edit goes
back to the symbology and both regenerate together. Change the colour of
*Primary* on the legend and the primary roads change with it, in the same
frame. A legend can never show a colour, symbol or pattern the map is not
using.

**Light and dark.** Every colour in the interface resolves through one set of
CSS custom properties, so the theme is a token swap rather than a second
stylesheet. Toggle in the header or on the home page; with no stored choice the
app follows your operating system.

**Three shapes, not one that squeezes.** On a wide screen the tool rail, the
left panel, the map and the inspector sit side by side. Narrower, the
inspector floats over the map when it is needed. On a phone the rail moves to
the bottom where a thumb is, and both panels become sheets over the map —
because on a small screen the map *is* the interface. Tapping the tool you are
already in puts the map back, and touching the map dismisses whatever is over
it. Anyone who has asked their system for less motion gets none.

**Shapes.** Rectangle, ellipse, triangle, diamond, star, line and arrow, with
fill, outline, dash style, corner radius and rotation — drawn by the same pair
of renderers as every other element, so they print exactly as previewed.

**An assistant.** Discuss the map or turn it into words for a report. A written
summary is composed locally from your layers and analysis figures and needs no
backend at all. For actual conversation, point it at a small server you run:

```bash
ANTHROPIC_API_KEY=sk-ant-... node server/ai-backend.mjs
```

Then paste `http://localhost:8787` into Assistant → Backend URL. **The browser
never holds an API key** — that process does, and it is the only thing that
talks to Claude. The studio sends only the map description it already shows you;
your data files are never uploaded. The reference backend is ~60 lines in
[`server/ai-backend.mjs`](server/ai-backend.mjs).

**Seventeen paper sizes**, grouped so an expensive mistake is hard to make:
*Sheet* (A6–A3, Letter, Legal, Tabloid) is what an office printer takes;
*Large format* (A2, A1, **A0**, B1, ARCH D, ARCH E, Poster 24×36) needs a
plotter; *Screen* covers social and presentation shapes.

**Export.** PNG or single-page PDF at the exact paper size, at 96, 150 or
300 dpi. The export crops the live map to the page frame, re-applies the
template's look filter and paper texture, and repaints every element with
canvas renderers that mirror the on-screen ones.

At plotter sizes the requested resolution is not always achievable — a
browser cannot allocate the 139-megapixel canvas that A0 at 300 dpi needs — so
page setup tells you the resolution you will actually get *before* you export,
rather than silently downscaling: "A0 is too big for 300 dpi in a browser —
the export will be 278 dpi (120 megapixels)". A1 and below print at the full
300.

**A project library.** Maps accumulate rather than overwrite. Save (⤓ in the
header, or Ctrl+S) files the current map into your projects with a thumbnail
rendered from the real page; leaving via the home button saves too, and an
autosave runs in the background once a map has a study area or a data layer —
so browsing templates never leaves stubs behind. The home page lists every
saved project newest first, opens one on click and deletes one from the ✕ on
its thumbnail. The 24 most recent are kept. Everything lives in this browser's
local storage; nothing is uploaded. If storage runs out the save sheds
thumbnails before it sheds projects, and tells you.

## What is measured, and what is assumed

Every number in this app is computed from geometry you can see. There is no
simulated data anywhere.

- **Areas and lengths** are geodesic, measured on the ellipsoid by Turf.
- **Distances** from *Nearest facility* are straight-line, not along roads.
- **Volume** is measured area × the depth you type. That is a planning
  estimate, not a survey, and it is labelled as such in the result, the
  summary and the printed credits.
- **Study-area figures** come from the mapped administrative outline, not
  from a cadastral source.
- **Feature counts** come from OpenStreetMap, which is community-mapped and
  uneven in coverage — absence of features is not evidence of absence.

## How the code is arranged

```
src/
├── main.js              entry point; landing ⇄ studio, boot order
├── core/                constants, DOM helpers, geo maths, map controller,
│                        store (state + pub/sub + undo + project library), toasts
├── data/                Nominatim boundaries, the dataset catalogue, the
│                        Overture→OSM supplement table, Overpass client,
│                        Overture PMTiles client, browser-side file parsing
├── layers/              registry (one ordered list of everything drawn),
│                        render (projects the registry onto MapLibre),
│                        symbology (mode → paint expression + legend),
│                        icons (one SVG path → map sprite, legend, canvas)
├── analysis/            the 8 geoprocessing tools (turf-backed)
├── ai/                  map context, local briefing, assistant transport
├── templates/           the 18-template catalogue and applyTemplate()
├── layout/              element catalogue (screen + canvas renderers),
│                        derived content, alignment, canvas drawing primitives
├── export/              crop, filter, texture and element compositing
├── ui/                  landing, studio chrome, theme, artboard interaction,
│                        inspector, legend editor (rows → symbology writes),
│                        and one module per left-hand panel
└── styles/              light/dark tokens, landing, studio, CSS thumbnails

src/data/cache/          the layered geodata cache (see below)

server/ai-backend.mjs    optional Node service; holds the Anthropic API key
server/cache-server.mjs  optional Node service; serves the shared database
server/db.mjs            SQLite schema and queries
server/prefetch.mjs      CLI that fills the database ahead of time
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

## The geodata cache

Overpass is a shared community service, and on a bad afternoon the same query
that took four seconds takes forty. Overture means pulling tiles over the
network every time. Neither is something to do twice for the same area.

So every open-data download now goes through a cache with three layers, asked
in order of how fast each can answer:

| | Where | Survives | Typical |
|---|---|---|---|
| **L1** | IndexedDB, in the browser | reloads, restarts, going offline | ~5 ms |
| **L2** | SQLite, via `cache-server.mjs` | everything; shared by everyone | ~15 ms |
| **L3** | Overpass / Overture | — | 5–40 s |

A hit at either cached layer is filled forward, so anything the shared
database serves is local from then on, and anything fetched live lands in
both. **Every layer is optional.** With no cache server running the app
behaves exactly as it did before — the client treats a refused connection as
a miss, trips a short circuit-breaker so it stops asking, and goes live.

Two things make it hit far more often than exact-match keying would:

- **Containment.** A stored download answers any request whose extent it
  fully covers, so an LGA inside a state you already fetched is already
  cached, and so is the same area after you pan. Features outside the
  caller's bbox are filtered off on the way back, so a hit is
  indistinguishable from a live fetch. Where no single download covers a
  request, a set of them can — see
  [areas larger than Overpass will answer](#areas-larger-than-overpass-will-answer).
- **Variants, not timestamps.** The cache key includes a hash of the Overpass
  query itself, and Overture's release id. Edit a catalogue entry and every
  download made under the old definition simply stops matching, instead of
  being served as data that no longer means what it says.

OpenStreetMap is edited continuously, so an entry older than 30 days is
*served immediately and refreshed in the background* — you see data at most
one interval old, and the next session sees today's.

### Running it

```bash
npm run cache
```

That is all: `vite.config.js` proxies `/api/cache` to it, so the browser
makes a same-origin request and CORS never arises. The database lands in
`server/data/geodata.db` (gitignored) and uses `node:sqlite`, so there is no
native module to build and nothing to install.

### Filling it ahead of time

On-demand caching only helps the *second* person to open an area. To stop the
first one waiting too, prefetch the places your team actually maps:

```bash
node server/prefetch.mjs --areas "Lagos, Nigeria" "Ogun, Nigeria"
```

```bash
node server/prefetch.mjs --nigeria --group services
```

`--list` prints the dataset slugs, `--dry-run` shows what would be fetched,
`--force` refetches areas already stored, and `--no-overture` skips the
supplements. It resumes: anything already in the database is skipped.

The two providers are paced differently, and deliberately:

- **Overpass** is asked for one thing at a time with a pause between each and
  exponential backoff on refusal. It is donated infrastructure, and a script
  that hammers it is why mirrors start saying no.
- **Overture** cells go in parallel (`--concurrency`, default 6, no delay).
  These are static PMTiles archives on S3 read by range request — there is no
  shared query engine to congest, and the studio itself already pulls them in
  a loop. Queueing them behind a courtesy delay bought nothing and cost most
  of the run.

A full national run still takes hours; start it and walk away.

`--status` prints coverage by region, which is the practical way to see where
a long run got to.

### Importing a whole country at once

Prefetching through Overpass works, but it is the slow road: thousands of
queries, tiled workarounds for anything state-sized, and a run that stalls
whenever the mirrors are busy. For a whole country, read the data locally
instead.

Geofabrik publishes each country as one file. Nigeria is a single ~700 MB
download containing every node, way and relation in it:

```bash
curl -L -o server/data/nigeria-latest.osm.pbf https://download.geofabrik.de/africa/nigeria-latest.osm.pbf
```

```bash
npm run import -- --nigeria --no-heavy
```

That populated all 37 states — 1,245 downloads, 375,855 features, 105 MB
compressed — in about **14 minutes**, against several hours for five regions
over Overpass. No rate limits, no mirror races, and no tiling: a state is just
a bounding-box filter over data already on disk, so each state and dataset is
stored as **one** entry and the studio gets a direct hit rather than an
assembled one.

The filtering is driven by the catalogue's own Overpass queries, compiled to
local predicates by [`server/ql.js`](server/ql.js) — so there is no second
definition of "what counts as a hospital" to drift out of step. Rows are
written under the same cache keys the live client uses, so the browser cannot
tell where they came from.

A PBF stores nodes, then ways, then relations, so what a way needs is always
behind it. Rather than hold a country's nodes in memory, the import makes
three streaming passes — ways and relations, then member ways, then node
locations — keeping ids and coordinates in sorted typed arrays.

**The heavy three are excluded above and that is deliberate.** Building
footprints, local roads and land use together match more ways than a V8 `Map`
can hold (~16.7M entries), and a state's worth of building polygons is more
than the map can draw in any case. Import them per city or LGA instead:

```bash
npm run import -- --areas "Kano, Nigeria" --datasets buildings
```

### Areas larger than Overpass will answer

The studio refuses a study area over 2,500 km² for heavy datasets, and 60,000
km² for the rest. That limit is about not asking a free public service for a
whole state in one query — so with `--tile` the prefetch script asks for the
same ground in pieces, which is a perfectly ordinary thing to do.

Those pieces are then put back together on read. When a request matches no
single stored download, the server looks for a *set* of cells that together
cover it, merges them, and drops the features that appear in more than one —
Overpass returns a road whole whenever it touches a query box, so anything
crossing a cell edge arrives twice. The merged result is stored under the
requested extent, so this happens once and every later request is an ordinary
single-row hit.

The effect is that a prefetched state loads data the live API would refuse
outright:

```
roads-local · Lagos State · 6,640 km² (limit 2,500 km²)
  assembled from 4 cells → 107,651 features, 503 duplicates dropped, 4.4 s
```

Coverage is tested by sweeping the requested rectangle along every stored
edge and checking each resulting piece, so cells may overlap, arrive in any
order, and come from different runs. A request reaching even slightly beyond
the prefetched grid is *not* covered and falls through to the live provider —
partial data is never passed off as complete.

### What this is not

It is not a mirror of OpenStreetMap or Overture. The OSM planet file is ~80 GB
compressed and Overture's release is around a terabyte of GeoParquet; neither
is reachable through the interfaces this app uses, and neither belongs in a
project database. This stores *the downloads this studio makes*, which is what
actually determines how fast it feels. If you ever do need the whole planet,
that is a different tool — a local Overpass instance from a planet PBF, or
DuckDB over Overture's S3 parquet.

## Attribution

Basemap © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors ·
Boundaries via Nominatim · Feature data © OpenStreetMap contributors ·
Overture Maps data © Overture Maps Foundation, drawn from OpenStreetMap
(ODbL), Google Open Buildings, Microsoft and Esri.

The Overture credit is added to the printed map only when a map actually
carries an Overture layer.

The public Nominatim and Overpass endpoints are shared community services.
Calls are throttled, cached and size-capped here, which is fine for demo and
internal use; a production deployment should point `ENDPOINTS` in
[`src/core/constants.js`](src/core/constants.js) at self-hosted instances or a
commercial provider.
