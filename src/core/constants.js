/** App-wide constants: basemaps, paper, fonts, palettes, geography presets. */

export const APP = {
  name: 'GIS Design Studio',
  org: 'Geoinfotech Resources Limited',
  version: '3.0.0',
};

/* ------------------------------------------------------------------ */
/* Basemaps — OpenFreeMap vector styles, free and key-less.            */
/* ------------------------------------------------------------------ */
export const BASEMAPS = {
  liberty:  { label: 'Liberty', url: 'https://tiles.openfreemap.org/styles/liberty',  hint: 'Full detail, colourful' },
  bright:   { label: 'Bright',  url: 'https://tiles.openfreemap.org/styles/bright',   hint: 'Clean and legible' },
  positron: { label: 'Minimal', url: 'https://tiles.openfreemap.org/styles/positron', hint: 'Pale — best under data' },
};

/**
 * "Looks" are CSS/canvas filters applied to the rendered basemap. They are
 * what turns one vector basemap into vintage, night, blueprint, etc., and
 * they are reproduced exactly at export time via ctx.filter.
 */
export const MAP_LOOKS = {
  none:      { label: 'True colour', filter: 'none' },
  soft:      { label: 'Soft print',  filter: 'saturate(0.72) contrast(0.96) brightness(1.03)' },
  vintage:   { label: 'Vintage',     filter: 'sepia(0.55) saturate(0.75) contrast(1.08) brightness(1.02)' },
  heritage:  { label: 'Heritage',    filter: 'sepia(0.85) saturate(0.6) contrast(1.12) brightness(0.98)' },
  night:     { label: 'Night',       filter: 'invert(0.92) hue-rotate(185deg) saturate(0.72) brightness(0.92)' },
  blueprint: { label: 'Blueprint',   filter: 'invert(0.9) sepia(1) hue-rotate(175deg) saturate(4) brightness(0.78)' },
  mono:      { label: 'Greyscale',   filter: 'grayscale(1) contrast(1.08)' },
  vivid:     { label: 'Vivid',       filter: 'saturate(1.45) contrast(1.06)' },
};

/** Paper / print textures drawn over the map at export time. */
export const MAP_TEXTURES = {
  none:  { label: 'None' },
  paper: { label: 'Paper grain' },
  linen: { label: 'Linen' },
  halftone: { label: 'Halftone dots' },
};

/** Free global DEM (Terrarium encoding) used for 3-D terrain templates. */
export const TERRAIN_SOURCE = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 13,
  attribution: 'Elevation: Mapzen / AWS Terrain Tiles',
};

/** Basemap layer-id substrings, grouped so users see plain-English toggles. */
export const BASEMAP_GROUPS = {
  roads:      { label: 'Roads & streets', match: ['road', 'transportation', 'bridge', 'tunnel', 'highway'] },
  water:      { label: 'Rivers & water',  match: ['water', 'waterway'] },
  buildings:  { label: 'Buildings',       match: ['building'] },
  boundaries: { label: 'Admin borders',   match: ['boundary', 'admin'] },
  labels:     { label: 'Place names',     match: ['label', 'place', 'poi', 'text'] },
  landcover:  { label: 'Parks & landuse', match: ['landcover', 'landuse', 'park', 'wood', 'forest'] },
};

/* ------------------------------------------------------------------ */
/* Paper                                                               */
/* ------------------------------------------------------------------ */
/**
 * Paper, smallest to largest, then the non-ISO sizes.
 *
 * `group` is only there so the picker can put a rule between wall-sized
 * plotter paper and the sheet sizes an office printer can actually take —
 * choosing A0 by mistake is an expensive surprise otherwise.
 */
export const PAPER_SIZES = {
  a6:     { label: 'A6',            wIn: 4.13, hIn: 5.83,  group: 'Sheet' },
  a5:     { label: 'A5',            wIn: 5.83, hIn: 8.27,  group: 'Sheet' },
  a4:     { label: 'A4',            wIn: 8.27, hIn: 11.69, group: 'Sheet' },
  a3:     { label: 'A3',            wIn: 11.69, hIn: 16.54, group: 'Sheet' },
  letter: { label: 'US Letter',     wIn: 8.5,  hIn: 11,    group: 'Sheet' },
  legal:  { label: 'US Legal',      wIn: 8.5,  hIn: 14,    group: 'Sheet' },
  tabloid:{ label: 'Tabloid',       wIn: 11,   hIn: 17,    group: 'Sheet' },

  a2:     { label: 'A2',            wIn: 16.54, hIn: 23.39, group: 'Large format' },
  a1:     { label: 'A1',            wIn: 23.39, hIn: 33.11, group: 'Large format' },
  a0:     { label: 'A0',            wIn: 33.11, hIn: 46.81, group: 'Large format' },
  b1:     { label: 'B1',            wIn: 27.83, hIn: 39.37, group: 'Large format' },
  arch_d: { label: 'ARCH D',        wIn: 24,    hIn: 36,    group: 'Large format' },
  arch_e: { label: 'ARCH E',        wIn: 36,    hIn: 48,    group: 'Large format' },
  poster: { label: 'Poster 24×36',  wIn: 24,    hIn: 36,    group: 'Large format' },

  square: { label: 'Social square', wIn: 8,    hIn: 8,     group: 'Screen' },
  story:  { label: 'Social story',  wIn: 6.75, hIn: 12,    group: 'Screen' },
  slide:  { label: 'Presentation',  wIn: 13.33, hIn: 7.5,  group: 'Screen', fixedOrientation: 'landscape' },
};

export const EXPORT_DPI = { screen: 96, standard: 150, print: 300 };

/**
 * The ceiling on one exported image, in pixels.
 *
 * Browsers refuse to allocate a canvas beyond a few hundred megapixels, and
 * long before that the tab runs out of memory mid-export. A0 at 300 dpi is
 * 139 megapixels of map, so on the large-format sizes this limit is reached
 * routinely rather than exceptionally — which is why the page setup panel
 * shows the resolution you will actually get instead of the one you asked
 * for.
 */
export const MAX_EXPORT_PIXELS = 120e6;

/** The dpi an export will really achieve at this paper size. */
export function effectiveDpi(wIn, hIn, dpi) {
  const px = wIn * dpi * hIn * dpi;
  if (px <= MAX_EXPORT_PIXELS) return dpi;
  return Math.floor(dpi * Math.sqrt(MAX_EXPORT_PIXELS / px));
}

/* ------------------------------------------------------------------ */
/* Typography available to end users                                   */
/* ------------------------------------------------------------------ */
export const FONTS = {
  sans:    { label: 'Sans (Source Sans 3)', stack: '"Source Sans 3", ui-sans-serif, system-ui, sans-serif' },
  display: { label: 'Display (Fraunces)',   stack: 'Fraunces, Georgia, serif' },
  serif:   { label: 'Serif (Georgia)',      stack: 'Georgia, "Times New Roman", serif' },
  mono:    { label: 'Mono (IBM Plex)',      stack: '"IBM Plex Mono", ui-monospace, monospace' },
};

/**
 * Element sizes are stored as a percentage of the artboard *width* so a
 * layout looks identical on screen and in a 300 dpi export.
 * The inspector shows friendly "pt" numbers: 1 pt = 0.1 % of page width.
 */
export const PT_TO_PCT = 0.1;

/* ------------------------------------------------------------------ */
/* Colour ramps offered to end users (colour-blind safe where noted)   */
/* ------------------------------------------------------------------ */
export const RAMPS = {
  risk:      { label: 'Risk (yellow → red)', colors: ['#fde68a', '#fbbf24', '#f97316', '#ea580c', '#b91c1c'] },
  water:     { label: 'Water (light → deep)', colors: ['#e0f2fe', '#7dd3fc', '#38bdf8', '#0284c7', '#075985'] },
  vegetation:{ label: 'Vegetation',           colors: ['#f7fcb9', '#addd8e', '#41ab5d', '#238443', '#005a32'] },
  earth:     { label: 'Earth tones',          colors: ['#f6e8c3', '#dfc27d', '#bf812d', '#8c510a', '#543005'] },
  viridis:   { label: 'Viridis (safe)',       colors: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] },
  diverging: { label: 'Diverging (safe)',     colors: ['#2166ac', '#92c5de', '#f7f7f7', '#f4a582', '#b2182b'] },
  mono:      { label: 'Greyscale (print)',    colors: ['#f1f5f9', '#cbd5e1', '#94a3b8', '#475569', '#0f172a'] },
};

/* ------------------------------------------------------------------ */
/* Study-area presets. Nigeria first because that is the team's focus, */
/* but the Nominatim lookup itself is global.                          */
/* ------------------------------------------------------------------ */
export const COUNTRIES = [
  { code: 'ng', name: 'Nigeria' },
  { code: 'gh', name: 'Ghana' },
  { code: 'ke', name: 'Kenya' },
  { code: 'za', name: 'South Africa' },
  { code: 'cm', name: 'Cameroon' },
  { code: 'bj', name: 'Benin' },
  { code: 'ne', name: 'Niger' },
  { code: 'td', name: 'Chad' },
  { code: '',   name: 'Anywhere in the world' },
];

export const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Federal Capital Territory',
  'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

export const ADMIN_LEVELS = [
  { id: 'country', label: 'Country',            hint: 'National outline' },
  { id: 'state',   label: 'State / Province',   hint: 'First-level admin unit' },
  { id: 'lga',     label: 'LGA / District',     hint: 'Second-level admin unit' },
  { id: 'city',    label: 'City / Town',        hint: 'Populated place' },
  { id: 'custom',  label: 'Search any place',   hint: 'Type anything — a park, a river, a campus' },
];

/** Public endpoints. Swap these for self-hosted instances in production. */
export const ENDPOINTS = {
  nominatim: 'https://nominatim.openstreetmap.org/search',
  // Raced, not tried in order — see data/overpass.js. More mirrors means a
  // congested one costs seconds rather than the whole request.
  //
  // Every entry MUST carry the full planet. Regional instances (overpass.osm.ch
  // is Switzerland-only, for example) answer fast with a valid *empty* result
  // outside their extract, which a race would happily accept as the winner.
  overpass: [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ],
};

export const ATTRIBUTION_TEXT =
  'Basemap © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors · Boundaries via Nominatim · Feature data © OpenStreetMap contributors';
