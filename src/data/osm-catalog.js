/**
 * Browsable OpenStreetMap dataset catalogue.
 *
 * Every entry is written in plain English for the panel and carries the
 * Overpass QL fragment that fetches it. `$bbox` is substituted with the
 * study area's south,west,north,east string at query time.
 */

export const OSM_GROUPS = [
  { id: 'transport', label: 'Roads & transport' },
  { id: 'water',     label: 'Water & nature' },
  { id: 'built',     label: 'Buildings & places' },
  { id: 'services',  label: 'Services & facilities' },
  { id: 'land',      label: 'Land use' },
  { id: 'risk',      label: 'Industry & hazard' },
];

/**
 * @typedef {object} OsmDataset
 * @property {string}  slug     stable id, also the de-duplication key
 * @property {string}  name     shown to the user
 * @property {string}  group    OSM_GROUPS id
 * @property {string}  icon
 * @property {string}  hint     one line of plain English
 * @property {'point'|'line'|'polygon'} kind
 * @property {string}  color
 * @property {string}  body     Overpass QL statements, `$bbox` templated
 * @property {string} [labelField]
 * @property {boolean}[heavy]   warn the user this can be a big download
 */

/** @type {OsmDataset[]} */
export const OSM_DATASETS = [
  /* ---- Roads & transport ---------------------------------------- */
  {
    slug: 'roads-major', name: 'Major roads', group: 'transport', icon: '═',
    hint: 'Motorways, trunk, primary and secondary roads',
    kind: 'line', color: '#334155', labelField: 'name',
    body: 'way["highway"~"^(motorway|trunk|primary|secondary)$"]($bbox);',
  },
  {
    slug: 'roads-all', name: 'All streets', group: 'transport', icon: '╬',
    hint: 'Every drivable road including residential streets',
    kind: 'line', color: '#64748b', heavy: true,
    body: 'way["highway"]["highway"!~"^(footway|path|steps|cycleway|track)$"]($bbox);',
  },
  {
    slug: 'railways', name: 'Railways', group: 'transport', icon: '⌸',
    hint: 'Rail lines and tram tracks',
    kind: 'line', color: '#1f2937',
    body: 'way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge)$"]($bbox);',
  },
  {
    slug: 'airports', name: 'Airports & airstrips', group: 'transport', icon: '✦',
    hint: 'Aerodromes, terminals and runways',
    kind: 'polygon', color: '#7c3aed', labelField: 'name',
    body: 'nwr["aeroway"~"^(aerodrome|terminal|runway)$"]($bbox);',
  },
  {
    slug: 'ferry', name: 'Ferry routes & jetties', group: 'transport', icon: '⌁',
    hint: 'Water transport routes and landing points',
    kind: 'line', color: '#0e7490',
    body: 'nwr["route"="ferry"]($bbox);\nnwr["amenity"="ferry_terminal"]($bbox);',
  },

  /* ---- Water & nature -------------------------------------------- */
  {
    slug: 'rivers', name: 'Rivers & streams', group: 'water', icon: '≋',
    hint: 'Flowing water — rivers, streams and canals',
    kind: 'line', color: '#0284c7', labelField: 'name',
    body: 'way["waterway"~"^(river|stream|canal|drain)$"]($bbox);',
  },
  {
    slug: 'waterbodies', name: 'Lakes & reservoirs', group: 'water', icon: '◉',
    hint: 'Standing water bodies and wetlands',
    kind: 'polygon', color: '#38bdf8', labelField: 'name',
    body: 'nwr["natural"="water"]($bbox);\nnwr["landuse"="reservoir"]($bbox);\nnwr["natural"="wetland"]($bbox);',
  },
  {
    slug: 'forests', name: 'Forests & woodland', group: 'water', icon: '▲',
    hint: 'Tree cover mapped in OSM',
    kind: 'polygon', color: '#15803d',
    body: 'nwr["natural"="wood"]($bbox);\nnwr["landuse"="forest"]($bbox);',
  },
  {
    slug: 'protected', name: 'Protected areas', group: 'water', icon: '⬡',
    hint: 'Reserves, national parks and conservation zones',
    kind: 'polygon', color: '#047857', labelField: 'name',
    body: 'nwr["boundary"="protected_area"]($bbox);\nnwr["leisure"="nature_reserve"]($bbox);',
  },

  /* ---- Buildings & places ---------------------------------------- */
  {
    slug: 'buildings', name: 'Building footprints', group: 'built', icon: '▦',
    hint: 'Every mapped building outline — heavy in dense cities',
    kind: 'polygon', color: '#94a3b8', heavy: true,
    body: 'way["building"]($bbox);',
  },
  {
    slug: 'settlements', name: 'Towns & villages', group: 'built', icon: '⌂',
    hint: 'Named settlements as points',
    kind: 'point', color: '#0f172a', labelField: 'name',
    body: 'node["place"~"^(city|town|village|hamlet|suburb)$"]($bbox);',
  },
  {
    slug: 'admin-wards', name: 'Local admin borders', group: 'built', icon: '▤',
    hint: 'Ward / district boundary relations inside the area',
    kind: 'polygon', color: '#475569', labelField: 'name',
    body: 'relation["boundary"="administrative"]["admin_level"~"^(6|7|8|9|10)$"]($bbox);',
  },

  /* ---- Services & facilities ------------------------------------- */
  {
    slug: 'health', name: 'Health facilities', group: 'services', icon: '✚',
    hint: 'Hospitals, clinics, doctors and pharmacies',
    kind: 'point', color: '#dc2626', labelField: 'name',
    body: 'nwr["amenity"~"^(hospital|clinic|doctors|pharmacy|health_post)$"]($bbox);\nnwr["healthcare"]($bbox);',
  },
  {
    slug: 'education', name: 'Schools & universities', group: 'services', icon: '✎',
    hint: 'Schools, colleges, universities and kindergartens',
    kind: 'point', color: '#2563eb', labelField: 'name',
    body: 'nwr["amenity"~"^(school|college|university|kindergarten)$"]($bbox);',
  },
  {
    slug: 'water-points', name: 'Water points & boreholes', group: 'services', icon: '⊕',
    hint: 'Drinking water, wells, boreholes and hand pumps',
    kind: 'point', color: '#0891b2', labelField: 'name',
    body: 'nwr["amenity"="drinking_water"]($bbox);\nnwr["man_made"~"^(water_well|borehole|water_tower)$"]($bbox);',
  },
  {
    slug: 'markets', name: 'Markets & commerce', group: 'services', icon: '◈',
    hint: 'Marketplaces, supermarkets and shopping centres',
    kind: 'point', color: '#c2410c', labelField: 'name',
    body: 'nwr["amenity"="marketplace"]($bbox);\nnwr["shop"~"^(supermarket|mall|department_store)$"]($bbox);',
  },
  {
    slug: 'emergency', name: 'Police, fire & emergency', group: 'services', icon: '★',
    hint: 'Emergency response points',
    kind: 'point', color: '#b91c1c', labelField: 'name',
    body: 'nwr["amenity"~"^(police|fire_station)$"]($bbox);\nnwr["emergency"="assembly_point"]($bbox);',
  },

  /* ---- Land use --------------------------------------------------- */
  {
    slug: 'landuse', name: 'Land use zones', group: 'land', icon: '▩',
    hint: 'Residential, commercial, industrial, farmland and more',
    kind: 'polygon', color: '#a16207', heavy: true, labelField: 'landuse',
    body: 'nwr["landuse"]($bbox);',
  },
  {
    slug: 'farmland', name: 'Farmland & agriculture', group: 'land', icon: '⌗',
    hint: 'Cropland, orchards and plantations',
    kind: 'polygon', color: '#ca8a04',
    body: 'nwr["landuse"~"^(farmland|farmyard|orchard|vineyard|plant_nursery)$"]($bbox);',
  },

  /* ---- Industry & hazard ------------------------------------------ */
  {
    slug: 'oil-gas', name: 'Oil & gas infrastructure', group: 'risk', icon: '⛁',
    hint: 'Pipelines, wells, refineries and storage tanks',
    kind: 'line', color: '#0f172a', labelField: 'name',
    body: 'nwr["man_made"="pipeline"]($bbox);\nnwr["man_made"~"^(petroleum_well|storage_tank)$"]($bbox);\nnwr["industrial"="oil"]($bbox);\nnwr["landuse"="industrial"]["industrial"~"oil|petroleum|refinery"]($bbox);',
  },
  {
    slug: 'power', name: 'Power grid', group: 'risk', icon: '⚡',
    hint: 'Transmission lines, substations and generators',
    kind: 'line', color: '#a21caf',
    body: 'way["power"~"^(line|minor_line)$"]($bbox);\nnwr["power"~"^(substation|plant|generator)$"]($bbox);',
  },
  {
    slug: 'industrial', name: 'Industrial sites', group: 'risk', icon: '▣',
    hint: 'Factories, works, quarries and waste sites',
    kind: 'polygon', color: '#57534e', labelField: 'name',
    body: 'nwr["landuse"~"^(industrial|quarry|landfill)$"]($bbox);\nnwr["man_made"="works"]($bbox);',
  },
];

export const datasetBySlug = (slug) => OSM_DATASETS.find((d) => d.slug === slug) ?? null;

export const datasetsInGroup = (group) => OSM_DATASETS.filter((d) => d.group === group);
