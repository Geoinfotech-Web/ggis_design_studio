<p align="center"><img src="docs/assets/mappix-logo.png" alt="Mappix Studio" width="420"></p>

# Mappix Studio — v1

*(formerly GIS Design Studio)*

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

## Manual AWS Docker deployment

This is the low-traffic deployment workflow for the private repository. Build
the images on the development Mac, transfer them to the dedicated Ubuntu EC2
instance, and restart the Compose stack. The server does not need the source
repository, Node.js, npm, or GitHub credentials.

Set these values in the commands below:

```text
YOUR_ELASTIC_IP       the instance's Elastic IP
YOUR_PRIVATE_KEY.pem  the EC2 SSH key downloaded when the instance was created
YOUR_DOMAIN           the HTTPS domain, for example mappix.studio
```

### 1. Build and archive on the Mac

Run from the repository root. Rebuild after application or Dockerfile changes:

```bash
docker compose build

docker save \
  -o /tmp/gis-studio-images.tar \
  gis-studio-web:latest \
  gis-geodata:latest

gzip -1 /tmp/gis-studio-images.tar
```

### 2. Copy the release to EC2

The Compose file only needs to be copied when it changes. Do not copy the
local `.env`; the production `.env` belongs on the server.

```bash
scp \
  -i ~/Downloads/YOUR_PRIVATE_KEY.pem \
  /tmp/gis-studio-images.tar.gz \
  ubuntu@YOUR_ELASTIC_IP:~/gis-studio/

# Only when docker-compose.yml changed:
scp \
  -i ~/Downloads/YOUR_PRIVATE_KEY.pem \
  docker-compose.yml \
  ubuntu@YOUR_ELASTIC_IP:~/gis-studio/
```

### 3. Back up and deploy on EC2

```bash
ssh -i ~/Downloads/YOUR_PRIVATE_KEY.pem ubuntu@YOUR_ELASTIC_IP

cd ~/gis-studio
mkdir -p server/data

# Back up users, sessions, and saved maps before replacing images.
docker compose run --rm --no-build backup-accounts

# Load the new images.
gunzip -c gis-studio-images.tar.gz | sudo docker load

# Recreate containers without building on the small server.
docker compose up -d --no-build
```

### 4. Verify the release

```bash
docker compose ps
curl https://YOUR_DOMAIN/api/account/health
curl https://YOUR_DOMAIN/api/cache/health
```

The account health response should contain `"ok":true`; the cache health
response should also contain `"ok":true`.

After verification, the uploaded archive can be removed from the server and
the temporary archive from the Mac:

```bash
# On EC2:
rm ~/gis-studio/gis-studio-images.tar.gz

exit

# Back on the Mac:
rm /tmp/gis-studio-images.tar.gz
```

Keep the production `.env` on the server. It should retain HTTPS settings such
as `COOKIE_SECURE=1` and `ALLOW_ORIGIN=https://YOUR_DOMAIN`.

Never run this during a normal deployment:

```bash
docker compose down -v
```

The `-v` option can delete the Docker volumes containing `accounts.db`,
`geodata.db`, and `world.db`. For the full architecture, HTTPS setup, data
imports, and backup guidance, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

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
