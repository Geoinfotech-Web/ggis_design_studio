/**
 * Analysis provider interface.
 *
 * A provider takes an {@link AnalysisRequest} and returns an
 * {@link AnalysisResult}. Everything above this line — the panel, the
 * legend element, the layer registry, the export — only knows the
 * result shape, so swapping the mock provider for real Earth Engine is
 * a one-line change in `setProvider()`.
 *
 * @typedef {object} AnalysisRequest
 * @property {object} job     an entry from analysis/jobs.js
 * @property {object} params  values for job.params
 * @property {{name:string, geojson:object, bbox:number[], areaKm2:number}} area
 *
 * @typedef {object} AnalysisResult
 * @property {'vector'|'raster'} type
 * @property {object}  [geojson]   when type === 'vector'
 * @property {string}  [tileUrl]   XYZ template, when type === 'raster'
 * @property {Array}   legend      [{ label, color, swatch }]
 * @property {object}  stats       job-specific numbers
 * @property {string}  summary     one sentence in plain English
 * @property {object}  meta        { provider, dataset, runAt, params, synthetic }
 *
 * @typedef {object} AnalysisProvider
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {() => boolean|Promise<boolean>} available
 * @property {(req: AnalysisRequest, opts?: {onProgress?: (s:string)=>void, signal?: AbortSignal}) => Promise<AnalysisResult>} run
 */

import { mockProvider } from './mock-provider.js';
import { geeProvider } from './gee-provider.js';

const registry = new Map();
export function registerProvider(provider) { registry.set(provider.id, provider); }

registerProvider(mockProvider);
registerProvider(geeProvider);

let activeId = 'mock';

export const listProviders = () => Array.from(registry.values());
export const getProvider = (id = activeId) => registry.get(id) ?? mockProvider;
export const activeProviderId = () => activeId;

export function setProvider(id) {
  if (!registry.has(id)) throw new Error(`Unknown analysis provider "${id}"`);
  activeId = id;
  return registry.get(id);
}

/**
 * Run a job through the active provider, with validation the UI can trust.
 * @param {AnalysisRequest} request
 * @param {{onProgress?: (s:string)=>void, signal?: AbortSignal, providerId?: string}} [opts]
 * @returns {Promise<AnalysisResult>}
 */
export async function runAnalysis(request, opts = {}) {
  const provider = getProvider(opts.providerId);
  if (!request.area?.geojson) {
    throw new Error('Choose a study area first — analysis needs a boundary to work inside.');
  }
  const ok = await provider.available();
  if (!ok) {
    throw new Error(`The “${provider.label}” provider is not configured. ${provider.description}`);
  }
  opts.onProgress?.(`Submitting to ${provider.label}…`);
  const result = await provider.run(request, opts);
  return {
    ...result,
    meta: {
      provider: provider.id,
      providerLabel: provider.label,
      dataset: request.job.dataset,
      runAt: new Date().toISOString(),
      params: request.params,
      areaName: request.area.name,
      ...(result.meta ?? {}),
    },
  };
}
