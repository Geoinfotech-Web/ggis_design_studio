/**
 * Analysis job catalogue.
 *
 * Each job describes a piece of Earth-observation analysis in plain
 * English (so a non-GIS user can pick one by the question it answers)
 * plus the machine-readable spec a provider needs to actually run it.
 *
 * Adding a new analysis = adding an entry here. Nothing else changes.
 */

export const JOB_CATEGORIES = [
  { id: 'land',    label: 'Land & vegetation' },
  { id: 'water',   label: 'Water & flooding' },
  { id: 'hazard',  label: 'Pollution & hazard' },
  { id: 'climate', label: 'Climate & heat' },
];

const DATE_PARAM = (key, label, def) => ({ key, label, type: 'month', default: def });

/** @type {Array<object>} */
export const ANALYSIS_JOBS = [
  {
    id: 'lulc',
    name: 'Land use / land cover',
    category: 'land',
    icon: '▩',
    question: 'What is my study area actually covered by?',
    blurb: 'Classifies every pixel into built-up, cropland, trees, water, grassland and bare ground.',
    dataset: 'ESA WorldCover 10 m / Google Dynamic World',
    output: 'classified',
    unit: 'km²',
    params: [
      DATE_PARAM('start', 'From', '2024-01'),
      DATE_PARAM('end', 'To', '2024-12'),
      { key: 'scheme', label: 'Classes', type: 'select', default: 'worldcover',
        options: [
          { value: 'worldcover', label: 'ESA WorldCover (11 classes)' },
          { value: 'simple', label: 'Simplified (6 classes)' },
        ] },
    ],
    classes: [
      { code: 10, label: 'Tree cover',   color: '#146b32' },
      { code: 20, label: 'Shrubland',    color: '#ffbb22' },
      { code: 30, label: 'Grassland',    color: '#ffff4c' },
      { code: 40, label: 'Cropland',     color: '#f096ff' },
      { code: 50, label: 'Built-up',     color: '#fa0000' },
      { code: 60, label: 'Bare / sparse',color: '#b4b4b4' },
      { code: 80, label: 'Water',        color: '#0064c8' },
      { code: 90, label: 'Wetland',      color: '#0096a0' },
    ],
    reading: (stats) => {
      const top = stats.classes?.[0];
      return top ? `${top.label} dominates, covering ${top.share.toFixed(1)}% of the study area.` : '';
    },
  },

  {
    id: 'ndvi',
    name: 'Vegetation health (NDVI)',
    category: 'land',
    icon: '▲',
    question: 'Where is vegetation thriving, and where is it stressed?',
    blurb: 'Greenness index from satellite red and near-infrared bands. Higher is healthier.',
    dataset: 'Sentinel-2 Level-2A, cloud-masked composite',
    output: 'index',
    unit: 'NDVI',
    range: [-0.2, 0.9],
    params: [
      DATE_PARAM('start', 'From', '2024-06'),
      DATE_PARAM('end', 'To', '2024-09'),
      { key: 'cloud', label: 'Max cloud cover', type: 'range', min: 5, max: 80, step: 5, default: 20, suffix: '%' },
    ],
    ramp: ['#a63603', '#e6550d', '#fdbe85', '#c7e9c0', '#41ab5d', '#00441b'],
    rampLabels: ['Bare', 'Sparse', 'Low', 'Moderate', 'Healthy', 'Dense'],
    reading: (stats) => `Mean NDVI is ${stats.mean?.toFixed(2)} — ${stats.mean > 0.5 ? 'generally healthy cover' : stats.mean > 0.25 ? 'moderate, patchy cover' : 'sparse or stressed vegetation'}.`,
  },

  {
    id: 'oil-spill',
    name: 'Oil spill detection',
    category: 'hazard',
    icon: '◒',
    question: 'Is there an oil slick on the water in my area?',
    blurb: 'Radar picks out dark, smooth patches on water — the classic signature of a surface slick. Radar sees through cloud and at night.',
    dataset: 'Sentinel-1 GRD (VV polarisation) + adaptive dark-spot threshold',
    output: 'mask',
    unit: 'km²',
    params: [
      DATE_PARAM('start', 'Incident window from', '2024-03'),
      DATE_PARAM('end', 'to', '2024-05'),
      { key: 'threshold', label: 'Detection sensitivity', type: 'range', min: 1, max: 5, step: 1, default: 3,
        suffix: '', hint: 'Higher finds more candidates but more false alarms' },
      { key: 'landmask', label: 'Mask out land', type: 'toggle', default: true },
    ],
    classes: [
      { code: 1, label: 'Likely slick',    color: '#111827' },
      { code: 2, label: 'Possible slick',  color: '#6b7280' },
      { code: 3, label: 'Affected shoreline', color: '#f59e0b' },
    ],
    caution: 'Dark radar patches can also be low wind, algal mats or shadow. Treat every detection as a lead to verify, not a confirmed spill.',
    reading: (stats) => `${stats.total?.toFixed(1)} km² of candidate slick detected across ${stats.patches ?? 0} patches.`,
  },

  {
    id: 'flood-extent',
    name: 'Flood extent',
    category: 'water',
    icon: '≋',
    question: 'How far did the water reach?',
    blurb: 'Compares radar imagery before and during an event to map standing water.',
    dataset: 'Sentinel-1 GRD change detection + HAND terrain filter',
    output: 'mask',
    unit: 'km²',
    params: [
      DATE_PARAM('baseline', 'Normal conditions', '2024-01'),
      DATE_PARAM('event', 'During the event', '2024-09'),
      { key: 'permanent', label: 'Exclude permanent water', type: 'toggle', default: true },
    ],
    classes: [
      { code: 1, label: 'Flood water',      color: '#1d4ed8' },
      { code: 2, label: 'Permanent water',  color: '#93c5fd' },
      { code: 3, label: 'Flood-prone land', color: '#bfdbfe' },
    ],
    reading: (stats) => `${stats.total?.toFixed(1)} km² inundated — about ${stats.share?.toFixed(1)}% of the study area.`,
  },

  {
    id: 'built-up',
    name: 'Built-up expansion',
    category: 'land',
    icon: '▦',
    question: 'How much has the built area grown?',
    blurb: 'Compares built-up surface between two years to show where a settlement is spreading.',
    dataset: 'GHSL Built-up Surface / Dynamic World',
    output: 'change',
    unit: 'km²',
    params: [
      { key: 'from', label: 'Baseline year', type: 'number', min: 1990, max: 2024, default: 2015 },
      { key: 'to',   label: 'Compare year',  type: 'number', min: 1990, max: 2025, default: 2024 },
    ],
    classes: [
      { code: 1, label: 'Built before baseline', color: '#64748b' },
      { code: 2, label: 'Newly built',           color: '#dc2626' },
      { code: 3, label: 'No longer built',       color: '#0d9488' },
    ],
    reading: (stats) => `${stats.gained?.toFixed(1)} km² of new built-up surface — a ${stats.growthPct?.toFixed(0)}% increase.`,
  },

  {
    id: 'lst',
    name: 'Land surface temperature',
    category: 'climate',
    icon: '◐',
    question: 'Where are the urban heat islands?',
    blurb: 'Surface temperature from thermal bands, showing which neighbourhoods run hottest.',
    dataset: 'Landsat 8/9 thermal (Collection 2) or MODIS LST',
    output: 'index',
    unit: '°C',
    range: [20, 48],
    params: [
      DATE_PARAM('start', 'From', '2024-02'),
      DATE_PARAM('end', 'To', '2024-04'),
      { key: 'time', label: 'Overpass', type: 'select', default: 'day',
        options: [{ value: 'day', label: 'Daytime' }, { value: 'night', label: 'Night-time' }] },
    ],
    ramp: ['#2166ac', '#67a9cf', '#d1e5f0', '#fddbc7', '#ef8a62', '#b2182b'],
    rampLabels: ['Coolest', '', '', '', '', 'Hottest'],
    reading: (stats) => `Surface temperature ranges ${stats.min?.toFixed(1)}–${stats.max?.toFixed(1)} °C, mean ${stats.mean?.toFixed(1)} °C.`,
  },

  {
    id: 'water-quality',
    name: 'Surface water & turbidity',
    category: 'water',
    icon: '◉',
    question: 'How murky is the water, and where?',
    blurb: 'Estimates suspended sediment from optical bands — useful downstream of mining, dredging or spills.',
    dataset: 'Sentinel-2 Level-2A, NDTI / normalised difference turbidity',
    output: 'index',
    unit: 'NDTI',
    range: [-0.3, 0.4],
    params: [
      DATE_PARAM('start', 'From', '2024-05'),
      DATE_PARAM('end', 'To', '2024-08'),
      { key: 'cloud', label: 'Max cloud cover', type: 'range', min: 5, max: 80, step: 5, default: 20, suffix: '%' },
    ],
    ramp: ['#08519c', '#4292c6', '#9ecae1', '#fed976', '#fd8d3c', '#bd0026'],
    rampLabels: ['Clear', '', '', '', '', 'Very turbid'],
    reading: (stats) => `Mean turbidity index ${stats.mean?.toFixed(2)} across ${stats.waterKm2?.toFixed(1)} km² of detected water.`,
  },

  {
    id: 'erosion-risk',
    name: 'Erosion susceptibility',
    category: 'hazard',
    icon: '◣',
    question: 'Which slopes are most likely to erode or gully?',
    blurb: 'Combines slope steepness, vegetation cover and rainfall intensity into a simple risk score.',
    dataset: 'SRTM 30 m + Sentinel-2 NDVI + CHIRPS rainfall',
    output: 'classified',
    unit: 'km²',
    params: [
      DATE_PARAM('start', 'Rainfall window from', '2024-04'),
      DATE_PARAM('end', 'to', '2024-10'),
      { key: 'weightSlope', label: 'Weight on slope', type: 'range', min: 0, max: 100, step: 10, default: 50, suffix: '%' },
    ],
    classes: [
      { code: 1, label: 'Low',       color: '#ffffcc' },
      { code: 2, label: 'Moderate',  color: '#fed976' },
      { code: 3, label: 'High',      color: '#fd8d3c' },
      { code: 4, label: 'Very high', color: '#e31a1c' },
      { code: 5, label: 'Severe',    color: '#800026' },
    ],
    reading: (stats) => {
      const high = (stats.classes ?? []).filter((c) => c.code >= 3).reduce((s, c) => s + c.share, 0);
      return `${high.toFixed(1)}% of the area falls in the high-or-worse erosion classes.`;
    },
  },
];

export const jobById = (id) => ANALYSIS_JOBS.find((j) => j.id === id) ?? null;
export const jobsInCategory = (id) => ANALYSIS_JOBS.filter((j) => j.category === id);

/** Default parameter object for a job. */
export function defaultParams(job) {
  return Object.fromEntries((job.params ?? []).map((p) => [p.key, p.default]));
}

/** Legend rows for a completed run — classified/mask use classes, index uses the ramp. */
export function legendFor(job) {
  if (job.output === 'index') {
    return job.ramp.map((color, i) => ({
      label: job.rampLabels?.[i] ?? '',
      color,
      swatch: 'ramp',
    })).filter((r, i, all) => r.label || i === 0 || i === all.length - 1);
  }
  return (job.classes ?? []).map((c) => ({ label: c.label, color: c.color, swatch: 'polygon', code: c.code }));
}
