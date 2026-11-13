# Changelog

All notable changes to Mappix Studio (formerly GIS Design Studio). Versions
follow [Semantic Versioning](https://semver.org).

## Unreleased

### Data that always loads
- When OpenStreetMap's public Overpass servers are slow (no answer within
  4 s) or fail, a dataset is built from the basemap's own OpenFreeMap vector
  tiles instead (`src/data/vectortiles.js`) — e.g. Nairobi major roads now
  load in about 5 s where Overpass failed after 43 s. The full Overpass download
  keeps running in the background and is stored for next time.
- Areas too large for Overpass (whole countries) load major roads, railways
  and rivers from the tiles instead of being refused.
- `server/supervise.mjs` (`npm run serve`) keeps the studio, data and
  accounts servers running and restarts any that stop;
  `npm run autostart` starts it at Windows sign-in.

### Phones and tablets
- Up to 900 px wide: panels are sheets over the lower part of the screen
  with the map visible above, a handle to expand and a close button; the
  Study area sheet opens by itself; zooming to an area allows for the sheet.
- One-row header; save, PNG, theme and sign out in a menu behind your
  initials. Sign-in dialog and Google button fit the screen; messages sit
  above the toolbar; 16 px inputs so iOS does not zoom.

### North arrows
- 14 north arrow styles in the families QGIS and ArcGIS Pro offer — simple,
  split and half-needle arrows, triangle, chevron, navigation pointer, arrow
  in a circle, compass needle, 4-point compass, star with N E S W, 8- and
  16-point compass roses, fletched arrow and N on a staff — picked from a
  visual gallery. Same geometry for screen and export.
- "Points to": true north (turns with the map) or always up; an adjustment
  angle for magnetic declination or grid convergence.

### Page layout on every screen
- The page frame is laid out in the visible part of the map (above the
  sheet on phones and tablets) and "zoom to area" fits the study area inside
  the page frame; opening or closing panels or resizing keeps the same
  ground inside the frame. Touch: drag elements, settings open when the
  finger lifts, finger-sized resize handles.

### Brand
- Renamed to **Mappix Studio**, with the new Mappix logo on the landing page,
  sign-in dialog, studio header, browser tab icon, home-screen icon and in
  exported PDFs' metadata. Vector logo in `src/ui/brand.js` (light and dark
  mode); static copies in `public/` and `docs/assets/`.

## 1.0.0 — first release (2026-10)

The first released version of the studio, then called GIS Design Studio. (Development builds before
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
