/**
 * Sheets produced by the Geoinfotech GIS department, each paired with the
 * studio template that reproduces its layout.
 *
 * One sheet per layout: each was traced element by element into a `gid-*`
 * template, and that template's thumbnail is this very sheet. Further sheets
 * drawn on the same layouts used to be listed too, but they offered the same
 * starting points over and over, so only the originals remain.
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
  ['ebola-distribution.jpg', 'Distribution of Ebola Virus Disease', 'Public health', 'Africa', 'gid-outbreak-dashboard', true],
].map(([image, title, topic, place, templateId, traced = false]) =>
  ({ image, title, topic, place, templateId, traced }));
