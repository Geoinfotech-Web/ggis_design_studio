/**
 * Sheets produced by the Geoinfotech GIS department, each paired with the
 * studio template that reproduces its layout.
 *
 * Six of these were traced element by element into `gid-*` templates and are
 * flagged `traced` — their template's thumbnail is that very sheet. The rest
 * are matched to whichever of those six layouts they were drawn on.
 *
 * This is what "Contributor" means when a map is started: begin from a
 * layout a contributor has already proved on a real sheet.
 */

export const CONTRIBUTOR = 'Geoinfotech GIS department';

export const CONTRIBUTIONS = [
  ['flood-susceptibility.jpg', 'Flood Susceptibility', 'Hazard', 'Rivers State, Nigeria', 'gid-hazard-plate', true],
  ['emerging-hotspots.jpg', 'Urban Expansion Hotspots', 'Urban analysis', 'Ondo State, Nigeria', 'gid-survey-sheet', true],
  ['lagos-study-area.jpg', 'Lagos State Study Area', 'Reference map', 'Lagos State, Nigeria', 'gid-study-area', true],
  ['africa-hydrography.jpg', 'The Rivers of Africa', 'Hydrography', 'Africa', 'gid-night-atlas', true],
  ['security-pressure-index.jpg', 'Security Pressure Index', 'Risk analysis', 'Nigeria', 'gid-index-poster', true],
  ['isochrone-ikeja.jpg', 'Travel Time from Major Landmarks', 'Accessibility', 'Ikeja, Lagos', 'gid-analyst-sheet', true],

  ['road-degradation-risk.jpg', 'Road Degradation Risk Index', 'Infrastructure', 'Lagos State, Nigeria', 'gid-study-area'],
  ['lagos-study-area-reference.jpg', 'Lagos State & 20 LGAs', 'Reference map', 'Lagos State, Nigeria', 'gid-study-area'],
  ['isochrone-landmarks.jpg', 'Landmark Travel-time Isochrones', 'Accessibility', 'Ikeja, Lagos', 'gid-analyst-sheet'],
  ['viewshed-amuwo-odofin.jpg', 'Viewshed / Visibility', 'Network analysis', 'Amuwo Odofin, Lagos', 'gid-analyst-sheet'],
  ['urban-heat-hotspot.jpg', 'Urban Heat Hotspot Intensity', 'Climate', 'Kano State, Nigeria', 'gid-hazard-plate'],
  ['continuous-rdri.jpg', 'Continuous Road Degradation Risk', 'Infrastructure', 'Lagos State, Nigeria', 'gid-study-area'],
  ['water-proximity.jpg', 'Water Proximity', 'Infrastructure', 'Lagos State, Nigeria', 'gid-study-area'],
  ['soil-moisture-index.jpg', 'Soil Moisture Index', 'Environment', 'Lagos State, Nigeria', 'gid-study-area'],
  ['terrain-slope.jpg', 'Terrain Slope', 'Topography', 'Lagos State, Nigeria', 'gid-study-area'],
  ['sar-backscatter.jpg', 'SAR Backscatter Change', 'Remote sensing', 'Lagos State, Nigeria', 'gid-study-area'],
  ['rainfall.jpg', 'Mean Annual Rainfall', 'Climate', 'Lagos State, Nigeria', 'gid-study-area'],
  ['africa-river-temperature.jpg', "Africa's River Lines", 'Climate', 'Africa', 'gid-night-atlas'],
  ['atlantic-bathymetry.jpg', 'Bathymetric Slices of the Atlantic', 'Bathymetry', 'Atlantic Ocean', 'gid-night-atlas'],
  ['ebola-distribution.jpg', 'Distribution of Ebola Virus Disease', 'Public health', 'Africa', 'gid-index-poster'],
  ['drought-monitoring.jpg', 'Weather Stations & Drought Monitoring', 'Climate', 'Nigeria', 'gid-index-poster'],
  ['deforestation-ekiti.jpg', 'Deforestation Comparison', 'Land cover', 'Ekiti State, Nigeria', 'gid-hazard-plate'],
].map(([image, title, topic, place, templateId, traced = false]) =>
  ({ image, title, topic, place, templateId, traced }));
