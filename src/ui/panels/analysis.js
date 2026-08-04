/**
 * Analysis pane — the Earth-observation side of the studio.
 *
 * Jobs are chosen by the question they answer, not by band maths. The
 * demo engine runs offline and is clearly labelled as synthetic; pointing
 * the Earth Engine provider at a backend URL is what makes the numbers
 * real, and nothing else in the app changes when you do.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, set, subscribe } from '../../core/store.js';
import { notify } from '../../core/toast.js';
import { JOB_CATEGORIES, jobsInCategory, defaultParams } from '../../analysis/jobs.js';
import { runAnalysis, listProviders, setProvider, activeProviderId } from '../../analysis/provider.js';
import { geeEndpoint, setGeeEndpoint } from '../../analysis/gee-provider.js';
import { addVectorLayer, addRasterLayer, removeLayer } from '../../layers/registry.js';
import { renderElements, hint } from '../artboard.js';
import { setTool } from '../tool.js';
import {
  head, section, group, row, empty, button, stack, labelled, select,
  slider, checkRow, textInput, miniBtn, pillRow, inline,
} from '../controls.js';

let pane;
let category = 'land';
let openJobId = null;
let params = {};
let running = false;
let controller = null;

/* ------------------------------------------------------------------ */
function openJob(job) {
  openJobId = job.id;
  params = defaultParams(job);
  render();
}

function paramControl(job, spec) {
  const value = params[spec.key];
  const update = (v) => { params[spec.key] = v; };

  switch (spec.type) {
    case 'month': {
      const input = el('input.field', { type: 'month', value });
      input.addEventListener('change', () => update(input.value));
      return labelled(spec.label, input, spec.hint);
    }
    case 'number': {
      const input = el('input.field', { type: 'number', value, min: spec.min, max: spec.max });
      input.addEventListener('change', () => update(Number(input.value)));
      return labelled(spec.label, input, spec.hint);
    }
    case 'select':
      return labelled(spec.label, select(spec.options, value, update), spec.hint);
    case 'range':
      return labelled(spec.label, slider({ ...spec, value }, update), spec.hint);
    case 'toggle':
      return checkRow(spec.label, value, update, spec.hint);
    default:
      return labelled(spec.label, textInput(String(value ?? ''), update), spec.hint);
  }
}

/* ------------------------------------------------------------------ */
async function run(job) {
  const area = state.studyArea;
  if (!area) {
    notify.warn('Analysis needs a study area to work inside.');
    setTool('area');
    return;
  }
  if (running) return;

  running = true;
  controller = new AbortController();
  set({ analysisBusy: true }, { history: false });
  render();

  const status = notify.busy(`Running <b>${job.name}</b>…`);
  try {
    const result = await runAnalysis({ job, params: { ...params }, area }, {
      signal: controller.signal,
      onProgress: (msg) => status.update(`${msg}<br /><b>${job.name}</b>`),
    });

    // One result layer per job — re-running replaces the previous one.
    state.layers.filter((l) => l.meta?.jobId === job.id).forEach((l) => removeLayer(l.id));

    const common = {
      name: job.name,
      source: 'analysis',
      legend: result.legend,
      description: result.summary,
      meta: { jobId: job.id, synthetic: Boolean(result.meta?.synthetic), provider: result.meta?.providerLabel },
    };

    if (result.type === 'raster') {
      addRasterLayer({ ...common, tileUrl: result.tileUrl, bbox: area.bbox, opacity: 0.85 });
    } else {
      addVectorLayer({
        ...common,
        geojson: result.geojson,
        kind: 'polygon',
        // Every feature carries its own colour, so the paint expression
        // reads it straight off the feature.
        style: {
          fill: ['coalesce', ['get', '_color'], '#0369a1'],
          fillOpacity: 0.78,
          strokeWidth: 0,
          stroke: '#00000000',
        },
      });
    }

    const runs = [...state.analysisRuns.filter((r) => r.job.id !== job.id), { job, params: { ...params }, result }];
    set({ analysisRuns: runs }, { history: false });
    renderElements();

    status.update(
      `<b>${job.name}</b> — ${result.summary || 'complete'}${result.meta?.synthetic ? '<br /><i>Demonstration data.</i>' : ''}`,
      { tone: 'ok', duration: 8000 },
    );
    hint('The legend and key-figure cards on the page updated themselves.');
  } catch (err) {
    if (err.name === 'AbortError') status.update('Analysis cancelled.', { tone: 'info', duration: 2500 });
    else status.update(err.message ?? 'The analysis failed.', { tone: 'error', duration: 9000 });
  } finally {
    running = false;
    controller = null;
    set({ analysisBusy: false }, { history: false });
    render();
  }
}

function removeRun(jobId) {
  state.layers.filter((l) => l.meta?.jobId === jobId).forEach((l) => removeLayer(l.id));
  set({ analysisRuns: state.analysisRuns.filter((r) => r.job.id !== jobId) }, { history: false });
  renderElements();
  render();
}

/* ------------------------------------------------------------------ */
function jobCard(job) {
  const isOpen = job.id === openJobId;
  const done = state.analysisRuns.some((r) => r.job.id === job.id);

  const header = row({
    icon: job.icon,
    title: job.name,
    sub: job.question,
    active: isOpen,
    onClick: () => { openJobId = isOpen ? null : job.id; if (!isOpen) openJob(job); else render(); },
    actions: done ? [el('span.chip', { text: '✓ run' })] : [],
  });

  if (!isOpen) return header;

  return el('div', { style: { marginBottom: '8px' } }, [
    header,
    el('div', { style: { padding: '8px 8px 2px', borderLeft: '2px solid #bae6fd', margin: '2px 0 0 13px' } }, [
      el('p', { text: job.blurb, style: { margin: '0 0 4px', fontSize: '11.5px', lineHeight: '1.45', color: '#475569' } }),
      el('p', { text: `Source: ${job.dataset}`, style: { margin: '0 0 10px', fontSize: '10px', color: '#94a3b8' } }),
      ...job.params.map((spec) => paramControl(job, spec)),
      job.caution ? el('p', {
        text: job.caution,
        style: { margin: '6px 0 8px', padding: '7px 9px', borderRadius: '9px', background: '#fffbeb', color: '#92400e', fontSize: '10.5px', lineHeight: '1.45' },
      }) : null,
      running
        ? inline([
            button('Cancel', () => controller?.abort(), 'ghost', { style: { width: '100%' } }),
          ])
        : button(`Run ${job.name.toLowerCase()}`, () => run(job), 'primary', { style: { width: '100%' } }),
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
function resultsSection() {
  if (!state.analysisRuns.length) return null;
  return section('Results', stack(state.analysisRuns.map((r) => el('div.card', { style: { padding: '9px 10px' } }, [
    el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' } }, [
      el('div', {}, [
        el('div', { text: r.job.name, style: { fontSize: '12.5px', fontWeight: '700' } }),
        el('div', { text: r.result.summary, style: { fontSize: '11px', color: '#475569', lineHeight: '1.4', marginTop: '2px' } }),
      ]),
      miniBtn('✕', 'Remove this result', () => removeRun(r.job.id)),
    ]),
    r.result.meta?.synthetic
      ? el('div', { text: 'Demonstration data — not a validated assessment', style: { marginTop: '6px', fontSize: '9.5px', fontWeight: '700', color: '#b45309' } })
      : el('div', { text: `via ${r.result.meta?.providerLabel ?? 'provider'}`, style: { marginTop: '6px', fontSize: '9.5px', color: '#94a3b8' } }),
  ]))));
}

function engineSection() {
  const active = activeProviderId();
  const endpoint = geeEndpoint();

  return group('Engine settings', stack([
    labelled('Analysis engine', select(
      listProviders().map((p) => ({ value: p.id, label: p.label })),
      active,
      (value) => {
        try { setProvider(value); notify.info(`Analysis engine: <b>${listProviders().find((p) => p.id === value).label}</b>`); }
        catch (err) { notify.error(err.message); }
        render();
      },
    )),
    labelled('Earth Engine backend URL', textInput(endpoint, (value) => setGeeEndpoint(value.trim()), {
      placeholder: 'https://your-server.example/gee',
    }), 'Your own service that holds the Earth Engine credentials. The request and response shape is documented at the top of src/analysis/gee-provider.js.'),
    el('p', {
      style: { margin: 0, fontSize: '10.5px', lineHeight: '1.5', color: '#94a3b8' },
      html: 'Earth Engine cannot be called safely from a browser — it needs a service-account key. Until a backend is configured, the demo engine produces realistic but <b>synthetic</b> results so the rest of the workflow can be designed and exported.',
    }),
  ]));
}

/* ------------------------------------------------------------------ */
export function render() {
  pane = pane ?? $('#pane-analysis');
  if (!pane) return;

  const area = state.studyArea;

  fill(pane, [
    head('Analysis', area
      ? `Satellite analysis for ${area.name}.`
      : 'Ask a question about your study area.'),
    area ? null : el('div.panel-section', {}, [
      empty('Analysis runs inside a boundary.<br />Pick a study area first.'),
      button('Choose a study area', () => setTool('area'), 'soft', { style: { width: '100%', marginTop: '10px' } }),
    ]),
    pillRow(JOB_CATEGORIES, category, (id) => { category = id; render(); }),
    el('div', { style: { padding: '4px 14px 12px' } }, jobsInCategory(category).map(jobCard)),
    resultsSection(),
    engineSection(),
  ]);
}

export function initAnalysisPane() {
  pane = $('#pane-analysis');
  render();
  subscribe(['studyArea', 'analysisRuns'], () => { if (state.activeTool === 'analysis') render(); });
}

export { render as renderAnalysisPane };
