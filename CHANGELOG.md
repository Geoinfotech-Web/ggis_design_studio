# Changelog

All notable changes to GIS Design Studio. Versions follow
[Semantic Versioning](https://semver.org).

## 1.0.0 — first release (2026-10)

The first released version of GIS Design Studio. (Development builds before
this were labelled "v3" internally; v1.0.0 is the first public version.)

### Study area
- Worldwide study-area search with suggestions as you type: 272 countries and
  territories, 3,929 states/regions and 38,933 districts/LGAs from
  OpenStreetMap (via Overture Maps), plus OpenStreetMap's towns and places.
- Every country in the country picker; districts listed for any region.
- Boundaries aligned with OpenStreetMap and the basemap, cut at the coastline.
- Topology: shared borders simplified once for both neighbours (no gaps or
  overlaps); invalid shapes repaired on import, on OSM lookups and on uploads.
- Coastal outlines from live OSM lookups trimmed to the basemap's own coast.
- Nigeria: state and LGA pickers, six geopolitical zones; several areas per map.

### Data
- 38 open datasets from OpenStreetMap and Overture Maps, merged and clipped.
- Shared database serves stored downloads at any age — layers load in
  ~0.1–0.3 s instead of 3–11 s; every Nigerian state pre-loaded, including
  local roads.
- Country-sized study areas loaded state by state from the database.
- Oversized requests explained plainly, with buttons for the alternatives.

### Map design and export
- 18 templates in eight styles plus contributor layouts; 19 basemaps;
  17 paper sizes up to A0.
- 44 point symbols, six line patterns, millimetre line weights, categorised
  and graduated symbology, editable generated legend.
- Page elements with snapping and alignment; locator inset in context.
- PDF/PNG export at 96–600 dpi, redrawn at export resolution.

### Accounts
- Email + password and Sign in with Google; maps saved to the account and
  synced across computers, with offline working copy.

### Operations
- Production packaging: web image (Vite build + nginx), accounts and cache
  services in Docker Compose; database restore and backup commands.
- Configuration documented in `.env.example`; `TRUST_PROXY` for correct
  rate limiting behind a proxy.
- AI backend updated to Claude Opus 5.5 (`AI_MODEL` to override).

### Removed
- The Analysis tool (buffer, nearest facility, volume and other geoprocessing
  tools) and its panel.
