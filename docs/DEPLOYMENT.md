# Deploying GIS Design Studio v1

How to run the studio in production. For what is still outstanding before
launch, see [HANDOVER.md](HANDOVER.md).

## Architecture

```
                 Internet (HTTPS)
                        │
             ┌──────────▼──────────┐   TLS terminates here:
             │  Reverse proxy / LB │   Caddy, Traefik, cloud LB, Cloudflare
             └──────────┬──────────┘
                        │ HTTP
             ┌──────────▼──────────┐
             │  web  (nginx :80)   │   built app (dist/) + routes:
             └───┬─────────────┬───┘
     /api/account│             │/api/cache
      ┌──────────▼───┐   ┌─────▼────────────┐
      │ accounts     │   │ cache            │
      │ Node :8789   │   │ Node :8788       │
      │ accounts.db  │   │ geodata.db       │
      │ (users, maps)│   │ world.db         │
      └──────────────┘   └──────────────────┘

   Browser also calls, directly:  OpenFreeMap / Esri tiles (basemaps),
   Nominatim + Overpass (live lookups), Overture PMTiles (supplements),
   Google Identity Services (sign-in)
```

- **One origin.** The browser only talks to the web container; nginx forwards
  `/api/account/*` and `/api/cache/*` to the two services. The session cookie
  is therefore first-party and no CORS is needed. In development, Vite does
  the same forwarding (`vite.config.js`).
- **Three SQLite databases**, all on Docker volumes:
  | Database | Service | Contents | Rebuildable? |
  |---|---|---|---|
  | `accounts.db` | accounts | users, sessions, saved maps | **No — back up daily** |
  | `geodata.db` | cache | cached open-data downloads | Yes (import / prefetch) |
  | `world.db` | cache | world administrative boundaries | Yes (extract + import) |
- The optional AI backend (`server/ai-backend.mjs`, :8787) is not part of the
  default stack — see [HANDOVER.md §3.4](HANDOVER.md#34-ai-assistant).

## Server requirements

| | Minimum | Comfortable |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB | 50 GB (room for more countries in the cache) |
| Software | Docker + Compose v2 | — |

Without Docker: Node.js **24+** (the services use the built-in `node:sqlite`)
and any web server able to serve static files and reverse-proxy two paths.

## Option A — Docker Compose (recommended)

```bash
git clone https://github.com/Geoinfotech-Web/ggis_design_studio.git
cd ggis_design_studio
cp .env.example .env          # set VITE_GOOGLE_CLIENT_ID at least
docker compose build
docker compose up -d          # web on :8080, plus accounts and cache
```

| Service | Image | Port | Volume |
|---|---|---|---|
| `web` | `deploy/Dockerfile.web` (Vite build → nginx) | `${WEB_PORT:-8080}` → 80 | — |
| `accounts` | `Dockerfile` | internal 8789 | `accounts` → `/data` |
| `cache` | `Dockerfile` | 8788 (also published for tools) | `geodata` → `/data` |

One-shot tools (profile `tools`, run with `docker compose run --rm <name>`):

| Tool | Does |
|---|---|
| `fetch` | Download a country extract from Geofabrik into `./server/data` |
| `import` | Build `geodata.db` from that extract (`--nigeria`, `--areas …`) |
| `prefetch` | Fill `geodata.db` from the live APIs |
| `backup` / `restore` | Move `geodata.db` in and out of the volume |
| `restore-world` | Install `./server/data/world.db` onto the volume |
| `backup-accounts` | Verified copy of `accounts.db` to `./server/data` |

Then put HTTPS in front (next section). Only the reverse proxy should be
reachable from the internet; do not publish 8788/8789 publicly.

> The images were written for v1 but have **not yet been built and tested**
> (Docker was unavailable on the development machine). Expect to verify them
> on first deployment.

## HTTPS

Any TLS-terminating proxy works. Example with Caddy, which obtains
certificates automatically:

```
# /etc/caddy/Caddyfile
studio.example.com {
    reverse_proxy localhost:8080
}
```

Caddy passes `X-Forwarded-For` and `X-Forwarded-Proto` by default. With
another proxy, make sure it does.

## Option B — without Docker

```bash
npm ci
VITE_GOOGLE_CLIENT_ID=... npm run build          # → dist/
```

Run the two services under a process manager (systemd, pm2, NSSM on Windows):

```bash
PORT=8789 COOKIE_SECURE=1 TRUST_PROXY=1 GOOGLE_CLIENT_ID=... \
  ACCOUNTS_DB=/var/lib/gis-studio/accounts.db node server/account-server.mjs

PORT=8788 CACHE_DB=/var/lib/gis-studio/geodata.db \
  WORLD_DB=/var/lib/gis-studio/world.db node server/cache-server.mjs
```

Serve `dist/` and proxy the two paths exactly as `deploy/nginx.conf` does —
note the trailing slashes: `/api/account/` maps to the service root `/`.

## Configuration

**Browser app** — baked in at build time (`VITE_*`, rebuild to change; none
is secret):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | *(empty)* | Turns on Sign in with Google |
| `VITE_CACHE_URL` | `/api/cache` | Where the cache service is reached |
| `VITE_AI_ENDPOINT` | *(empty)* | AI assistant backend URL |

**Account service** (`server/account-server.mjs`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8789` | Listen port |
| `ACCOUNTS_DB` | `server/data/accounts.db` | Database file |
| `GOOGLE_CLIENT_ID` | from `.env` `VITE_GOOGLE_CLIENT_ID` | Audience checked on Google tokens |
| `COOKIE_SECURE` | off | **Set to `1` in production** (cookie only over HTTPS) |
| `TRUST_PROXY` | off | Set to `1` behind nginx/LB so rate limits see the real client IP |
| `MAX_PROJECT_BYTES` | 26214400 | Largest saved map (bytes) |

**Cache service** (`server/cache-server.mjs`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8788` | Listen port |
| `CACHE_DB` | `server/data/geodata.db` | Open-data cache |
| `WORLD_DB` | `server/data/world.db` | World boundaries |
| `CACHE_BUDGET` | 8 GB | Size at which least-used downloads are pruned |
| `ALLOW_ORIGIN` | `http://localhost:5173` | CORS origin, only for direct (non-proxied) calls |
| `MAX_UPLOAD` | 128 MB | Largest download the browser may store |

**AI backend** (`server/ai-backend.mjs`, optional): `ANTHROPIC_API_KEY`,
`AI_MODEL` (default `claude-opus-5-5`), `PORT` (8787), `ALLOW_ORIGIN`.

## Data

### World boundaries (`world.db`)

Countries, regions and districts for the whole world from **Overture Maps
divisions**, which are OpenStreetMap's boundaries. Either copy an existing
`world.db` (fastest), or build it:

```bash
pip install duckdb
npm run extract:world -- world-divisions.ndjson.gz     # ~600 MB download, ~30 min
npm run import:world  -- world-divisions.ndjson.gz     # ~15 min, needs ~4 GB RAM
```

The import writes `world.db.new` and swaps it in at the end, so stop the
cache service first on Windows (it cannot replace an open file). With Docker,
put the file in `./server/data` and run `docker compose run --rm restore-world`,
then `docker compose restart cache`.

### Open-data cache (`geodata.db`)

Copy an existing database (`backup` on the source machine → `restore` on the
server), or build it from an OpenStreetMap extract:

```bash
docker compose run --rm fetch                              # Nigeria by default
docker compose run --rm import --nigeria --no-heavy        # ~15 min
docker compose run --rm import --nigeria --datasets roads-local
```

Other countries: `EXTRACT_PATH=africa/ghana-latest EXTRACT=ghana-latest docker
compose run --rm fetch`, then import with `--areas "…"`.

### Refreshing the data

OpenStreetMap changes daily. Re-run `fetch` + `import` monthly (a cron job is
fine); the importer replaces entries under the same keys. Refresh
`world.db` when Overture publishes a new release (pass the release id as the
second argument to `extract:world`; releases are listed at
<https://stac.overturemaps.org/catalog.json>).

## Backups

```bash
docker compose run --rm backup-accounts     # → ./server/data/accounts-backup.db
```

Schedule it daily and copy the file off the server. Without Docker:
`node server/backup-sqlite.mjs /path/accounts.db /backups/accounts-$(date +%F).db`.
Restore by stopping the accounts service and putting the copy back in place
of `accounts.db`.

## Health checks

| URL | Healthy answer |
|---|---|
| `https://<domain>/` | 200, the landing page |
| `https://<domain>/api/account/health` | `{"ok":true,"google":true}` |
| `https://<domain>/api/cache/health` | `{"ok":true,…}` |

## Updating

```bash
git pull
docker compose build
docker compose up -d
```

Volumes survive rebuilds. Browsers pick up the new app at once (the HTML is
served `no-cache`; built assets are fingerprinted).

## Licences and third-party services

| Service | Used for | Terms to check before commercial launch |
|---|---|---|
| OpenStreetMap data | boundaries, features | ODbL — attribution on every map (the studio prints it) |
| Overture Maps | boundaries, supplements | ODbL / CDLA — attribution (printed automatically) |
| OpenFreeMap | vector basemaps | Free, no key |
| Esri World Imagery etc. | satellite, terrain, canvas basemaps | **Esri terms**: commercial/high-volume use needs an ArcGIS account |
| OpenTopoMap | topographic basemap | CC-BY-SA; heavy users should self-host |
| tile.openstreetmap.org, tile.openstreetmap.fr | OpenStreetMap / Humanitarian basemaps | **Tile usage policies forbid heavy use** — replace or self-host for a public launch |
| Nominatim (public) | live place search | Max 1 req/s, no bulk use — self-host or commercial at scale |
| Overpass (public) | live feature downloads | Fair use — the shared cache keeps this low |
| Google Identity Services | Sign in with Google | Published consent screen, privacy policy and terms URLs |
| Anthropic API | AI assistant (optional) | Paid per use |
