# GIS Design Studio — v1

Template-based map design for people who are not GIS specialists. Choose a
study area anywhere in the world, start from a cartographic template, drop in
open data, arrange the title, legend and scale bar on the page, and export a
print-ready PDF or PNG.

Built by **Geoinfotech Resources Limited**. Design system shared with the
team's Flood Watch platform (<https://gfw.ggis.africa>).

| | |
|---|---|
| **Version** | 1.0.0 — first release |
| **Front end** | Vanilla JavaScript (ES modules), Vite, MapLibre GL, Turf |
| **Back end** | Node.js 24 — three small services, SQLite via built-in `node:sqlite` |
| **Data** | OpenStreetMap, Overture Maps, OpenFreeMap basemaps |
| **Tests** | Vitest — `npm run test:run` |

## What it does

- **Study area anywhere in the world.** Search as you type across 272
  countries and territories, 3,929 states/regions and 38,933 districts/LGAs —
  OpenStreetMap's own boundaries, cut at the coastline, topologically clean.
  Or upload a boundary (zipped Shapefile, GeoJSON, KML, KMZ, GPX). Several
  areas can be combined on one map; Nigeria also offers its six geopolitical
  zones.
- **Start from a template.** 18 cartographic templates in eight styles, plus
  layouts traced from published Geoinfotech map sheets, or a blank page in any
  of 17 paper sizes up to A0.
- **Open data in one click.** 38 datasets (roads, rivers, health, schools,
  markets, power…) from OpenStreetMap and Overture Maps, clipped to the study
  area and already symbolised by type. Served from a shared database, so most
  layers load in well under a second.
- **Real cartography.** 19 basemaps, 44 point symbols, six line patterns, line
  weights in millimetres of paper, categorised and graduated colouring, an
  editable legend that is always generated from the map itself.
- **Page layout.** Title, legend, scale bar, north arrow, locator inset, key
  figures, credits, logo, neatline, shapes — drag, snap and align on the page.
- **Print-quality export.** PDF or PNG at 96–600 dpi; the map is re-drawn at
  the export resolution, not enlarged from the screen.
- **Accounts.** Email + password or Sign in with Google; every map is saved to
  the account and opens on any computer.
- **AI assistant** (optional) for discussing the map or writing it up.

See **[docs/FEATURES.md](docs/FEATURES.md)** for the full description.

## Run it locally

Needs **Node.js 24+** (for the built-in `node:sqlite`).

```bash
npm install
npm run cache        # geodata + world boundaries service   :8788
npm run accounts     # accounts and saved maps              :8789
npm run dev          # the studio                           :5173
```

Open <http://localhost:5173>. On Windows, `start-studio.bat` starts all three.

Optional: copy `.env.example` to `.env` and set `VITE_GOOGLE_CLIENT_ID` to turn
on Sign in with Google. Without it, email + password sign-in works.

The world boundary search needs the world database (`server/data/world.db`,
~430 MB, not in git). Build it once — see
[docs/DEPLOYMENT.md → Data](docs/DEPLOYMENT.md#data). Without it the studio
falls back to searching OpenStreetMap online.

## Documentation

| Document | For |
|---|---|
| [docs/HANDOVER.md](docs/HANDOVER.md) | **Web team: start here.** Status, what is done, what is left |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Going live: architecture, Docker, HTTPS, configuration, data, backups |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | How the code works: modules, state, data pipelines, security |
| [docs/API.md](docs/API.md) | HTTP endpoints of the three services |
| [docs/FEATURES.md](docs/FEATURES.md) | Everything the studio does, in detail |
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | How to make a map, for end users |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |
| [tests/README.md](tests/README.md) | What the test suite covers |

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server with API proxies (:5173) |
| `npm run build` | Production build into `dist/` |
| `npm run test:run` | Run the test suite once |
| `npm run cache` | Geodata cache + world boundaries service (:8788) |
| `npm run accounts` | Account service (:8789) |
| `npm run ai` | Optional AI assistant backend (:8787) |
| `npm run import -- --nigeria` | Fill the geodata cache from a local OSM extract |
| `npm run prefetch -- --areas "…"` | Fill the geodata cache from the live APIs |
| `npm run extract:world -- file.ndjson.gz` | Download world boundaries from Overture |
| `npm run import:world -- file.ndjson.gz` | Build `world.db` from that download |

## Attribution

Boundaries and feature data © OpenStreetMap contributors (ODbL), boundaries
via Overture Maps · Overture Maps data © Overture Maps Foundation · Basemaps
© OpenFreeMap / OpenMapTiles, © Esri and data partners, OpenTopoMap (CC-BY-SA).
The studio composes the correct credit for each map and prints it on the page.
See [docs/DEPLOYMENT.md → Licences](docs/DEPLOYMENT.md#licences-and-third-party-services)
before commercial use.

© Geoinfotech Resources Limited.
