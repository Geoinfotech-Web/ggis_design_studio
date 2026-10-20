# Handover to the web team — GIS Design Studio v1

This is the first release (**v1.0.0**) of GIS Design Studio. The application
works end to end on a developer machine. This document says what is finished,
what the web team needs to do to put it live, and what is still left to build.

- Repository: <https://github.com/Geoinfotech-Web/ggis_design_studio> (branch `main`)
- How to deploy: [DEPLOYMENT.md](DEPLOYMENT.md)
- How it works: [TECHNICAL.md](TECHNICAL.md) · endpoints: [API.md](API.md)

---

## 1. What v1 contains

| Area | Status |
|---|---|
| Landing page, sign-up / sign-in dialog | Done |
| Email + password accounts (scrypt-hashed, httpOnly session cookie, rate-limited) | Done |
| Sign in with Google (token verified server-side) | Done — needs production OAuth setup (§3.1) |
| Projects saved to the account, available on any computer | Done |
| Study area: worldwide search with suggestions, LGA/district lists, Nigerian zones, uploads | Done |
| World boundaries (OSM-aligned, topology-clean) | Done — database must be copied to the server (§2.4) |
| Open data: 38 datasets, OSM + Overture, shared cache | Done — Nigeria pre-loaded; other countries load live the first time |
| Templates, basemaps, symbology, page layout, legend, export to PDF/PNG | Done |
| AI assistant | Built-in summary works offline; live chat needs a hosted backend + API key (§3.4) |
| Production packaging (Docker, nginx) | Written — **not yet built or tested in Docker** (§2.1) |
| Tests | 90 unit tests passing; no CI yet (§3.5) |

The Analysis tool from earlier prototypes was removed in v1 on purpose.

---

## 2. Required to go live

These are the minimum steps. Without them the site will not work properly in
production.

### 2.1 Build and test the containers
The `Dockerfile`, `deploy/Dockerfile.web`, `deploy/nginx.conf` and
`docker-compose.yml` were written and the compose file validates, but Docker
was not running on the development machine, so **the images have never been
built**. Build them on the server or a CI runner and fix anything that comes
up:

```bash
docker compose build
docker compose up -d
curl http://localhost:8080/api/account/health
curl http://localhost:8080/api/cache/health
```

### 2.2 Domain and HTTPS
- Point the chosen domain at the server and terminate HTTPS in front of the
  `web` container (Caddy, Traefik, a cloud load balancer or Cloudflare).
- HTTPS is **mandatory**: the session cookie is `Secure` in production
  (`COOKIE_SECURE=1`, the compose default) and Google sign-in requires it.

### 2.3 Google sign-in for the live domain
In Google Cloud Console → APIs & Services:
1. **Credentials → the OAuth client → Authorised JavaScript origins**: add
   `https://<your-domain>` (keep `http://localhost:5173` for development).
2. **OAuth consent screen**:
   - Set the **App name to "GIS Design Studio"**. The existing client was
     shown to users as *"Security NGA"* during testing; that name comes from
     the consent screen and must be corrected.
   - Add the app logo, the support email, and the **home page, privacy
     policy and terms of service URLs** (see §3.1 — these pages do not exist yet).
   - Switch **Publishing status from "Testing" to "In production"**. While in
     Testing, only listed test users can sign in with Google.
3. Build the web image with the client ID:
   `VITE_GOOGLE_CLIENT_ID=… docker compose build web`.

### 2.4 Copy the data to the server
Two databases are too large for git and must be transferred once
([DEPLOYMENT.md → Data](DEPLOYMENT.md#data)):

| File | Size | What happens without it |
|---|---|---|
| `world.db` | ~430 MB | Worldwide study-area search falls back to slower online search |
| `geodata.db` | ~500 MB | Every data layer is fetched live from public servers (3–15 s each, larger areas refused) |

### 2.5 Backups and monitoring
- **Back up `accounts.db` daily** — it holds every user and every saved map.
  The other two databases can be rebuilt.
- Monitor the three health endpoints (`/api/account/health`,
  `/api/cache/health`, and the web root) and alert on failure.

---

## 3. Still to be done

Listed in suggested priority within each group.

### 3.1 Sign-up and sign-in (highest priority)

| # | Item | Notes |
|---|---|---|
| 1 | **Forgot password / password reset** | Not built. Needs an email provider (SMTP, SendGrid, Resend…), a reset-token table, two endpoints (`POST /reset-request`, `POST /reset`) and a "Forgot password?" link in the sign-in dialog. Today a user who forgets their password cannot get back in. |
| 2 | **Email verification** for email + password sign-ups | Not built. Anyone can register with an address they do not own. Same email provider as #1. Google accounts are already verified by Google. |
| 3 | **Terms of service and privacy policy pages** | Not built. Required by Google for a published consent screen, and by Nigeria's NDPA / GDPR. Link them from the sign-up dialog ("By signing up you agree to…"). |
| 4 | **Account settings** | Not built. Change name, change password, set a password on a Google-only account, see/sign out other sessions. |
| 5 | **Delete account** (and its maps) | Not built. Needed for data-protection compliance. The schema already cascades: deleting the user row removes their sessions and projects. |
| 6 | **More sign-in options** | Only Google today. **Microsoft (Entra ID)** is recommended next — many organisations and government users have Microsoft accounts. Apple is optional. Each needs its own OAuth app; follow the Google pattern (verify the ID token on the server, link by verified email). |
| 7 | **Sign-in rate limits across instances** | Limits are kept in the memory of one account-server process. Fine for one server; if you run several, move them to Redis or the reverse proxy. |
| 8 | Admin / user management | No admin screen. User support currently means querying `accounts.db` directly. |

### 3.2 Infrastructure

| # | Item | Notes |
|---|---|---|
| 1 | **CI pipeline** | No GitHub Actions yet. Add one that runs `npm ci`, `npm run test:run` and `npm run build` on every pull request, and builds the Docker images. |
| 2 | **Error logging** | Services log to stdout only. Collect container logs; consider Sentry for the browser app. |
| 3 | **Usage analytics** | None. Add privacy-respecting analytics (e.g. Plausible) if needed; update the privacy policy. |
| 4 | **Scheduled data refresh** | The Nigeria data was imported from an August 2026 extract. Re-run the import monthly with a fresh Geofabrik extract ([DEPLOYMENT.md](DEPLOYMENT.md#refreshing-the-data)). |
| 5 | **Pre-load more countries** | Only Nigeria is pre-loaded. Import other priority countries the same way (Geofabrik publishes every country). |

### 3.3 Third-party services and licences

| # | Item | Notes |
|---|---|---|
| 1 | **Esri basemaps** (Satellite, Terrain, Canvas) | Used without a key, which is fine for internal use and evaluation. Commercial or high-volume use needs an ArcGIS subscription or a different imagery provider. |
| 2 | **Public Nominatim and Overpass** | Shared community services with usage policies (Nominatim: max 1 request/second, identifying traffic). Acceptable at launch; at scale, self-host or use a commercial provider (`ENDPOINTS` in `src/core/constants.js`). The local world database already takes most search traffic off Nominatim. |
| 3 | **OpenTopoMap** | Asks heavy users to run their own tile server. |
| 4 | **OpenStreetMap and Humanitarian basemaps** | Served from the OpenStreetMap Foundation's and OpenStreetMap France's tile servers, whose policies forbid heavy or commercial use. Fine for light internal use; for a public launch, switch these to a commercial tile provider or a self-hosted server (`BASEMAPS` in `src/core/constants.js`), or remove them. |
| 5 | **National Geographic basemap** | An Esri service — covered by the Esri terms in #1. |

### 3.4 AI assistant
The built-in written summary needs no server. The conversational assistant
needs `server/ai-backend.mjs` hosted with an `ANTHROPIC_API_KEY` (paid, billed
per use) and `VITE_AI_ENDPOINT` set at build time. Decide whether to offer it
at launch; it is not in the default compose stack.

### 3.5 Quality and testing
- Cross-browser testing (Chrome, Edge, Firefox, Safari). WebGL is required.
- Phone and tablet testing — the responsive layout exists but has had little
  real-device testing.
- An accessibility review (keyboard use, screen readers, contrast).
- Load test the account and cache services before a public launch.

---

## 4. Known limitations in v1

- **Buildings and local roads for a whole country** are deliberately refused
  (millions of features — the browser cannot draw them and they are unreadable
  at that scale). They work for a state, LGA or city. Local roads are
  pre-loaded for every Nigerian state; buildings are fetched live per area.
- **607 of 38,933 districts** have no parent region in the source data, so
  they are listed without one.
- Region names follow OpenStreetMap, so some carry a suffix
  (*"Lagos State"*, *"Kebbi State"*).
- A few tiny gaps (under 0.1 km²) between neighbouring districts exist in
  OpenStreetMap itself and were kept so the boundaries stay identical to OSM.
- Saved maps are limited to 200 per account and 25 MB each (configurable).

## 5. Contacts and access

- Product owner: *(fill in)*
- Google Cloud project holding the OAuth client: *(fill in — the web team
  needs access to update the consent screen and authorised origins)*
- Domain registrar / DNS: *(fill in — candidate names are being chosen)*
