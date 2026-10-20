# Technical documentation — GIS Design Studio v1

How the code is organised and why. For running it in production see
[DEPLOYMENT.md](DEPLOYMENT.md); for endpoints see [API.md](API.md).

## Stack

| Layer | Technology |
|---|---|
| Browser app | Vanilla JavaScript ES modules, no framework; Vite 6 for dev server and build |
| Map | MapLibre GL JS 4 (WebGL); OpenFreeMap vector styles, Esri / OpenTopoMap rasters |
| Geometry | Turf v7 (area, bbox, buffer, union, intersect, difference), `polygon-clipping` |
| Data decoding | `osmtogeojson` (Overpass), `pmtiles` + `@mapbox/vector-tile` + `pbf` (Overture, ocean tiles), `shpjs` and `@tmcw/togeojson` (uploads) |
| Export | Canvas 2D compositing, `jspdf` for PDF |
| Services | Node.js 24, plain `node:http`, `node:sqlite`, `node:crypto` — no web framework, no native modules |
| Data tooling | Python + DuckDB (world boundary extract only) |
| Tests | Vitest |

## Repository layout

```
index.html               single page: landing + studio shell
src/
├── main.js              entry point; landing ⇄ studio, boot order, autosave
├── core/                constants, DOM helpers, geo maths, map controller,
│                        store (state, pub/sub, undo, project library + sync),
│                        auth + Google sign-in, flow (which tools are open), toasts
├── data/                study areas: OSM lookup (boundaries.js), world database
│                        client (world.js), coast trimming (land.js), LGA lists
│                        and Nigerian zones (admin.js), the area list (study-areas.js);
│                        open data: catalogue, Overpass + Overture clients and merge;
│                        cache/ (browser + shared database layers); uploads
├── layers/              registry (everything drawn), render (→ MapLibre),
│                        symbology (paint + legend), icons (44 SVG symbols)
├── layout/              page elements (screen + canvas renderers), alignment,
│                        derived text, shapes, drawing primitives
├── templates/           template catalogue and applyTemplate()
├── export/              PDF/PNG rendering at print resolution
├── ai/                  map description for the assistant, transport
├── ui/                  landing, auth dialog, chrome, artboard, inspector,
│                        legend editor, place search, one module per panel
│   └── panels/          area, start, templates, data, elements, layers, projects, ai
└── styles/              light/dark tokens, landing, studio, previews
server/
├── account-server.mjs   accounts + saved maps                      :8789
├── cache-server.mjs     geodata cache + world boundaries           :8788
├── ai-backend.mjs       optional assistant (holds the API key)     :8787
├── db.mjs               geodata cache schema and queries
├── world.mjs            world boundaries schema and queries
├── topology.mjs         topology-preserving simplification + repair
├── extract-world.py     pull world boundaries from Overture (DuckDB)
├── import-world.mjs     build world.db
├── import-pbf.mjs       build geodata.db from an OSM extract (+ ql.js, regions.mjs)
├── prefetch.mjs         fill geodata.db from the live APIs
├── backup-db.mjs        verified copy of geodata.db
└── backup-sqlite.mjs    verified copy of any database (use for accounts.db)
deploy/                  production web image (Dockerfile.web) + nginx.conf
tests/                   Vitest suite (see tests/README.md)
legacy/                  the pre-v1 single-file prototype, kept for reference only
```

## Core rules

1. **Modules do not call each other.** They write state with `set()` and react
   with `subscribe(keys, fn)` (`src/core/store.js`). Panels, map and export
   all render from the same state, so they cannot drift apart.
2. **Study areas are a list.** `state.studyAreas` is the source of truth;
   `state.studyArea` is its combined view (merged geometry, union area,
   `parts`). Both are written together by `src/data/study-areas.js`. Code that
   only needs "the area" reads `studyArea`; data fetching iterates `parts`.
3. **Every page element is defined once** (`src/layout/elements.js`) with its
   screen renderer and canvas renderer side by side — what you see is what
   prints.
4. **Line widths are millimetres of paper**, converted to pixels only at draw
   time (preview from the artboard scale, export from the chosen dpi).
5. **Legends are generated** from layer symbology; editing a legend row edits
   the symbology.
6. **The flow gate** (`src/core/flow.js`): nothing but Study area and My
   projects opens until a study area exists.

## Study areas

Three sources, one object shape (`name, displayName, level, geojson, bbox,
areaKm2, center, countryCode, osmId…`):

| Source | Module | Notes |
|---|---|---|
| World database | `data/world.js` → `/api/cache/world` | Search-as-you-type for countries, regions, districts anywhere; outline in one gzipped row |
| OpenStreetMap live | `data/boundaries.js` (Nominatim), `data/admin.js` (Overpass) | Nigeria's states/LGAs, towns and named places; Nigerian zones assembled from states |
| Upload | `data/upload.js` | Zipped Shapefile, GeoJSON, KML, KMZ, GPX — parsed in the browser |

Every outline passes two clean-up steps before use:

- **Sea trimming** (`data/land.js`). OSM country/state boundaries run out to
  the territorial-sea limit (~22 km off Lagos). The ocean polygons are read
  from the same OpenFreeMap vector tiles the basemap draws (`water` layer,
  class `ocean`) and subtracted, so the coast matches the basemap and land
  borders stay exactly OSM's. A coarse z5 pass finds coastal tiles, then z8
  tiles (~40 m) are read only there. Fails open: if tiles can't be read the
  outline is used as drawn.
- **Topology repair** (`cleanPolygons` in `core/geo.js`, called by
  `addStudyArea` and by the upload parser). A polygon union of each feature
  with itself splits self-crossing rings, merges overlapping parts and orients
  rings consistently, so clipping and dissolving cannot fail later.

### World boundaries pipeline

```
Overture divisions (GeoParquet on S3, built from OSM relations)
  └─ extract-world.py   DuckDB: class='land', subtypes country/dependency/region/county,
  │                     coordinates rounded to 1e-5° (~1 m), gzipped NDJSON
  └─ import-world.mjs   per level:
       pass 1  count every vertex and fingerprint which units use it  (topology.mjs VertexTable)
       pass 2  pin junctions / ends of shared borders; Douglas–Peucker (~3 m) between pins,
               always in a canonical direction, so both neighbours get identical borders;
               repair with polygon union; measure; link districts to regions by ISO 3166-2 code
     → world.db (SQLite: name index + gzipped geometry per unit), swapped in atomically
```

Verified for Nigeria, Kenya, Ghana and Benin: zero overlap, zero invalid
shapes, borders matching OSM to the 5th decimal (e.g. Kebbi's bounding box).

## Open data pipeline

Thirty-eight datasets (`data/osm-catalog.js`), each an Overpass query plus,
for 34 of them, an Overture supplement. Overture features are translated to
OSM tags first (`data/overture-merge.js`) so one classifier, one symbology and
one legend handle both; duplicates are removed by source attribution, then by
name + 40 m proximity.

Every download goes through a layered cache (`data/cache/`):

| Layer | Where | Typical |
|---|---|---|
| L1 | IndexedDB in the browser | ~5 ms |
| L2 | `geodata.db` via the cache service, shared by all users | 15–300 ms |
| L3 | Overpass (raced across mirrors) / Overture PMTiles | 3–40 s |

- A stored download answers any request **inside** its bounding box; the
  server can also assemble a request from several stored tiles.
- Shared-database entries are **served whatever their age** — the database is
  refreshed by re-importing, not per request (asking for fresh-only sent every
  request back to Overpass once an import was a month old).
- Size limits (2,500 km² heavy / 60,000 km² other) apply only when the
  public API would have to be asked. A **country-sized** study area is fetched
  region by region from the database (`piecesFor` in `ui/panels/data.js`) and
  clipped to the country outline. Heavy datasets at country scale are refused
  with a plain explanation and alternatives.
- The cache is filled ahead of time by `import-pbf.mjs` (whole country from a
  Geofabrik extract, per state) or `prefetch.mjs` (live APIs, tiled).

## Accounts and project sync

- `server/account-server.mjs` with `accounts.db` (`users`, `sessions`,
  `projects`). Passwords: scrypt with a random salt, compared in constant
  time. Sessions: random 32-byte token in an httpOnly cookie, stored as
  SHA-256, 30-day expiry.
- Google: Google Identity Services in the browser returns an ID token; the
  server verifies signature (Google's JWKS), audience, issuer, expiry and
  verified email, then creates or links the account.
- `core/store.js` keeps a working copy of the library in localStorage so lists
  draw instantly and work continues offline; saves are queued in an outbox
  and sent when the service is reachable; on sign-in the server library is
  pulled down (newest `savedAt` wins).
- Autosave starts once a map has a study area, layers or a project id, so
  browsing templates never creates empty projects.

## Export

`export/render.js` builds a second, off-screen MapLibre map with the same CSS
size and camera at a higher pixel ratio, so the map is redrawn at the export
dpi rather than enlarged. Elements are drawn by their canvas renderers on top.
PDFs embed losslessly up to 40 megapixels. The page setup panel warns when a
browser cannot reach the requested dpi at plotter sizes.

## Security

| Concern | Handling |
|---|---|
| Password storage | scrypt + salt; never logged or returned |
| Session theft | httpOnly cookie (no script access), `SameSite=Lax`, `Secure` in production, token hashed at rest |
| CSRF | `SameSite=Lax` cookie plus JSON-only bodies; state-changing requests are POST/PUT/DELETE |
| Brute force | per-IP and per-email throttles; `TRUST_PROXY` controls whether `X-Forwarded-For` is believed |
| Account enumeration | one message for unknown email and wrong password |
| Google tokens | verified server-side; the browser's claim is never trusted |
| API keys | the Anthropic key lives only in the AI backend process |
| Uploaded files | parsed in the browser; never sent to a server (except as part of a saved map) |
| Shared cache writes | `PUT /api/cache/entry` is open to any studio user so downloads are shared. A malicious user could store wrong data for an area. Acceptable for an internal tool; for a public launch, restrict writes (e.g. require a signed-in session at the proxy, or only allow server-side imports) |

Not yet implemented: password reset, email verification, account deletion —
see [HANDOVER.md §3.1](HANDOVER.md#31-sign-up-and-sign-in-highest-priority).

## Testing

```bash
npm run test:run
```

90 tests across geometry helpers, cache keys and symbology
([tests/README.md](../tests/README.md)). Not covered by automated tests: the
servers' HTTP routes, the importers, and the UI (verified manually in the
browser). Adding route tests for the account service is a good first step.

## Versioning

`package.json` and `APP.version` in `src/core/constants.js` hold the version
(1.0.0); the version string is shown in the studio and written into exported
PDFs. Browser storage keys that contain `v3` (e.g. `gds.projects.v3`) are
historical names of stored data, not version labels — renaming them would
make existing users' saved work disappear, so leave them.
