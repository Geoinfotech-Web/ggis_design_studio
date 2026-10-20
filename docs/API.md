# HTTP API reference — v1

The studio has three small Node services. In development and production the
browser reaches the first two through the same origin:

| Service | Source | Port | Browser path |
|---|---|---|---|
| Accounts | `server/account-server.mjs` | 8789 | `/api/account/…` |
| Geodata cache + world boundaries | `server/cache-server.mjs` | 8788 | `/api/cache/…` |
| AI assistant (optional) | `server/ai-backend.mjs` | 8787 | `VITE_AI_ENDPOINT` |

Paths below are relative to each service (so `/signin` is
`/api/account/signin` from the browser). Bodies are JSON unless stated.
Errors are `{ "error": "message" }`; account form errors also carry
`"field"` naming the input to highlight.

---

## Accounts — `/api/account`

Session: an `httpOnly`, `SameSite=Lax` cookie `gds_session`, valid 30 days
(`Secure` when `COOKIE_SECURE=1`). Only a SHA-256 of the token is stored.

**User object** returned by the sign-in endpoints and `/me`:

```json
{ "id": "u_…", "name": "Ada", "email": "ada@example.org", "picture": "",
  "google": false, "password": true }
```

| Method | Path | Auth | Body | Success |
|---|---|---|---|---|
| GET | `/health` | — | — | `{ ok, google }` — `google` says whether Google sign-in is configured |
| GET | `/config` | — | — | `{ googleClientId }` |
| POST | `/signup` | — | `{ name, email, password }` (password ≥ 8 chars) | 201 `{ user }` + session cookie |
| POST | `/signin` | — | `{ email, password }` | 200 `{ user }` + session cookie |
| POST | `/google` | — | `{ credential }` (Google ID token) | 200 `{ user, created }` + session cookie |
| POST | `/signout` | — | — | 200 `{ ok }`, cookie cleared |
| GET | `/me` | optional | — | `{ user }` or `{ user: null }` (always 200) |
| GET | `/projects` | ✓ | — | `{ projects: [{ id, name, templateId, savedAt, thumb }] }` — newest first; `?full=1` adds `doc` |
| GET | `/projects/:id` | ✓ | — | `{ project: { …, doc } }` |
| PUT | `/projects/:id` | ✓ | `{ name, templateId, savedAt, thumb, doc }` | `{ ok, savedAt }` |
| DELETE | `/projects/:id` | ✓ | — | `{ ok }` |

Notes:
- **Errors:** 400 invalid input · 401 wrong credentials / not signed in ·
  409 email already registered, or project limit (200) reached · 413 body too
  large (`MAX_PROJECT_BYTES`, 25 MB) · 429 too many attempts.
- **Rate limits** (per minute): sign-up 10 per IP; sign-in 8 per IP and 6 per
  email; Google 20 per IP. In memory, per process.
- **Google:** the ID token's signature is checked against Google's published
  keys, plus audience, issuer, expiry and verified email. An existing password
  account with the same email is linked, not duplicated.
- **Saving:** when two computers save the same map, the later `savedAt` wins;
  an older save is refused with 409 `{ error, savedAt }` so it cannot roll the
  newer one back.
- `:id` matches `[A-Za-z0-9_-]{1,64}`.

---

## Geodata cache — `/api/cache`

Stores every OpenStreetMap / Overture download the studio makes, gzipped. A
stored download answers any request whose bounding box it contains.

| Method | Path | Query / body | Success |
|---|---|---|---|
| GET | `/health` | — | `{ ok, db, origin }` |
| GET | `/stats` | — | `{ entries, bytes, … }` |
| GET | `/entry` | `provider`, `dataset`, `bbox=w,s,e,n`, optional `variant`, `key`, `maxAge` (ms) | 200 GeoJSON FeatureCollection, or 404 |
| GET | `/has` | same as `/entry` | `{ bbox, features, … }` or 404 — existence only, no body |
| PUT | `/entry` | `{ key, provider, dataset, variant, bbox, meta, geojson }` | 201 `{ ok, … }` |
| DELETE | `/entries` | optional `provider`, `dataset`, `olderThan` (ms epoch) | `{ ok, removed }` |

`/entry` responses send the stored gzip as-is (`Content-Encoding: gzip`);
facts about the entry come in headers: `X-Cache-Bbox`, `X-Cache-Created`,
`X-Cache-Exact`, `X-Cache-Features`, `X-Cache-Meta` (base64 JSON). When no
single download covers a request, the server tries to assemble one from
stored tiles, then stores the result.

> `PUT /entry` and `DELETE /entries` accept writes from any client that can
> reach the service. Behind the production proxy that is any browser using
> the studio. See [TECHNICAL.md → Security](TECHNICAL.md#security) for the
> trade-off and how to restrict it.

## World boundaries — `/api/cache/world`

Served by the cache service from `world.db`. Returns 503 if the database is
not installed (the studio then searches online instead).

**Unit summary:**

```json
{ "id": 4105, "name": "Ikeja", "level": "lga", "country": "Nigeria",
  "countryCode": "ng", "parentId": 112, "parentName": "Lagos State",
  "bbox": [3.30, 6.55, 3.38, 6.66], "areaKm2": 49.2 }
```

`level` is `country`, `state` (first-level region) or `lga` (second-level
district).

| Method | Path | Query | Success |
|---|---|---|---|
| GET | `/world/search` | `q` (≥ 2 chars; `"Ikeja, Lagos"` narrows by region/country), optional `country` (ISO alpha-2), `level`, `parent`, `limit` (≤ 50) | `[unit, …]` — exact names first, then prefix, then larger units |
| GET | `/world/list` | `country` + `level`, or `parent` | `[unit, …]` sorted by name |
| GET | `/world/unit/:id` | — | GeoJSON geometry (gzipped); the unit summary in the `X-World-Unit` header (base64 UTF-8 JSON) |

---

## AI assistant (optional)

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/health` | — | `{ ok, mode: "claude" \| "no-key", model }` |
| POST | `/chat` | `{ context, messages: [{ role, content }] }` | `{ reply }` |

`context` is the map description the studio builds (study area, layers,
styling) — never the user's data files. Without `ANTHROPIC_API_KEY` the
service answers with a locally composed summary, labelled as such.
