/**
 * Right-hand panel.
 *
 * Shows whichever thing is selected: a page element, a data layer, or —
 * when nothing is selected — the page setup. Each element type declares
 * which control groups it wants via `inspect` in layout/elements.js, so
 * adding an element type never means editing a switch statement here.
 */

import { $, el, fill } from '../core/dom.js';
import { state, set, subscribe, checkpoint, touch } from '../core/store.js';
import { FONTS, PAPER_SIZES } from '../core/constants.js';
import { ELEMENT_TYPES, elementLabel } from '../layout/elements.js';
import { updateElement, removeElement, duplicateElement, renderElements, layoutArtboard } from './artboard.js';
import { updateLayer, removeLayer, shade } from '../layers/registry.js';
import { propertyKeys } from '../data/upload.js';
import { flyToBounds } from '../core/map.js';
import { boundsFromBbox } from '../core/geo.js';
import {
  head, section, labelled, select, textArea, textInput, slider, seg,
  colorInput, checkRow, button, stack, inline, inspectorRow,
} from './controls.js';

let panel;

/* ================================================================== */
/* element inspector                                                   */
/* ================================================================== */
const styleSetter = (elm, history = false) => (patch) => {
  if (history) checkpoint();
  updateElement(elm.id, { style: patch }, { history: false });
  renderElements();
};

function groupText(elm) {
  return section('Text', stack([
    textArea(elm.text ?? '', (value) => {
      updateElement(elm.id, { text: value, auto: false }, { history: false });
      renderElements();
    }, 4),
    el('p', {
      style: { margin: 0, fontSize: '10px', color: '#94a3b8', lineHeight: '1.4' },
      text: 'Line breaks are kept exactly as you type them.',
    }),
  ]));
}

function groupHeading(elm) {
  return section('Heading', textInput(elm.text ?? '', (value) => {
    updateElement(elm.id, { text: value, auto: false }, { history: false });
    renderElements();
  }, { placeholder: 'Leave empty to hide the heading' }));
}

function groupType(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  return section('Type', stack([
    labelled('Typeface', select(
      Object.entries(FONTS).map(([value, f]) => ({ value, label: f.label })),
      s.font, (value) => setStyle({ font: value }),
    )),
    inspectorRow('Size', slider({ min: 5, max: 70, step: 0.5, value: s.size }, (v) => setStyle({ size: v }))),
    labelled('Weight', seg(
      [{ value: 400, label: 'Regular' }, { value: 600, label: 'Medium' }, { value: 800, label: 'Bold' }],
      s.weight, (value) => setStyle({ weight: Number(value) }),
    )),
    labelled('Alignment', seg(
      [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }],
      s.align, (value) => setStyle({ align: value }),
    )),
    inspectorRow('Colour', colorInput(s.color, (value) => setStyle({ color: value }))),
    inspectorRow('Line spacing', slider({ min: 1, max: 2.2, step: 0.05, value: s.lineHeight ?? 1.3 }, (v) => setStyle({ lineHeight: v }))),
    checkRow('Italic', Boolean(s.italic), (on) => setStyle({ italic: on })),
  ]));
}

function groupChrome(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  return section('Card', stack([
    inline([
      colorInput(s.bg, (value) => setStyle({ bg: value })),
      el('span', { text: 'Background', style: { fontSize: '11.5px', color: '#475569', flex: '1' } }),
    ]),
    inspectorRow('Opacity', slider({ min: 0, max: 1, step: 0.02, value: s.bgOpacity ?? 0 }, (v) => setStyle({ bgOpacity: v }))),
    inline([
      colorInput(s.border, (value) => setStyle({ border: value })),
      el('span', { text: 'Border', style: { fontSize: '11.5px', color: '#475569', flex: '1' } }),
    ]),
    inspectorRow('Border width', slider({ min: 0, max: 6, step: 0.1, value: s.borderWidth ?? 0 }, (v) => setStyle({ borderWidth: v }))),
    inspectorRow('Corner radius', slider({ min: 0, max: 30, step: 0.5, value: s.radius ?? 0 }, (v) => setStyle({ radius: v }))),
    inspectorRow('Padding', slider({ min: 0, max: 30, step: 0.5, value: s.padding ?? 0 }, (v) => setStyle({ padding: v }))),
    checkRow('Drop shadow', Boolean(s.shadow), (on) => setStyle({ shadow: on })),
  ]));
}

function groupNorth(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  return section('North arrow', stack([
    labelled('Style', seg(
      [{ value: 'arrow', label: 'Arrow' }, { value: 'needle', label: 'Needle' }, { value: 'compass', label: 'Compass' }],
      s.variant, (value) => setStyle({ variant: value }),
    )),
    inspectorRow('Colour', colorInput(s.color, (value) => setStyle({ color: value }))),
    inspectorRow('Label size', slider({ min: 4, max: 30, step: 0.5, value: s.size }, (v) => setStyle({ size: v }))),
    checkRow('Show the letter N', s.showLabel !== false, (on) => setStyle({ showLabel: on })),
    el('p', {
      style: { margin: 0, fontSize: '10px', color: '#94a3b8', lineHeight: '1.4' },
      text: 'The arrow turns with the map, so it stays honest if you rotate the view.',
    }),
  ]));
}

function groupScale(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  return section('Scale bar', stack([
    labelled('Style', seg(
      [{ value: 'checker', label: 'Checker' }, { value: 'bar', label: 'Solid' }, { value: 'line', label: 'Bracket' }],
      s.variant, (value) => setStyle({ variant: value }),
    )),
    labelled('Alignment', seg(
      [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }],
      s.align, (value) => setStyle({ align: value }),
    )),
    inspectorRow('Colour', colorInput(s.color, (value) => setStyle({ color: value }))),
    inspectorRow('Thickness', slider({ min: 1, max: 14, step: 0.5, value: s.thickness ?? 4 }, (v) => setStyle({ thickness: v }))),
    inspectorRow('Label size', slider({ min: 4, max: 24, step: 0.5, value: s.size }, (v) => setStyle({ size: v }))),
  ]));
}

function groupNeatline(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  return section('Frame', stack([
    inspectorRow('Colour', colorInput(s.color, (value) => setStyle({ color: value }))),
    inspectorRow('Line width', slider({ min: 0.2, max: 8, step: 0.1, value: s.borderWidth }, (v) => setStyle({ borderWidth: v }))),
    checkRow('Double line', Boolean(s.inner), (on) => setStyle({ inner: on })),
    inspectorRow('Inner gap', slider({ min: 0.5, max: 12, step: 0.1, value: s.gap ?? 2 }, (v) => setStyle({ gap: v }))),
  ]));
}

function groupInset(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  return section('Locator', stack([
    inspectorRow('Fill', colorInput(s.fill, (value) => setStyle({ fill: value }))),
    inspectorRow('Fill opacity', slider({ min: 0, max: 1, step: 0.05, value: s.fillOpacity ?? 0.35 }, (v) => setStyle({ fillOpacity: v }))),
    inspectorRow('Outline', colorInput(s.stroke, (value) => setStyle({ stroke: value }))),
    state.studyArea ? null : el('p', {
      style: { margin: 0, fontSize: '10.5px', color: '#b45309', lineHeight: '1.4' },
      text: 'Load a study area and its outline appears here.',
    }),
  ]));
}

function groupLegend(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  return section('Legend', stack([
    inspectorRow('Swatch size', slider({ min: 5, max: 30, step: 0.5, value: s.swatch ?? 13 }, (v) => setStyle({ swatch: v }))),
    inspectorRow('Row spacing', slider({ min: 0, max: 12, step: 0.2, value: s.gap ?? 2.6 }, (v) => setStyle({ gap: v }))),
    el('p', {
      style: { margin: 0, fontSize: '10px', color: '#94a3b8', lineHeight: '1.4' },
      text: 'Rows come from the visible layers — turn a layer off and it leaves the legend.',
    }),
  ]));
}

function groupLogo(elm) {
  const setStyle = styleSetter(elm);
  const input = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setStyle({ src: String(reader.result) }); };
    reader.readAsDataURL(file);
    input.value = '';
  });

  return section('Image', stack([
    button(elm.style.src ? 'Replace image' : 'Choose an image', () => input.click(), 'soft', { style: { width: '100%' } }),
    input,
    elm.style.src ? button('Remove image', () => setStyle({ src: '' }), 'ghost', { style: { width: '100%' } }) : null,
    labelled('Fit', seg(
      [{ value: 'contain', label: 'Fit inside' }, { value: 'cover', label: 'Fill box' }],
      elm.style.fit, (value) => setStyle({ fit: value }),
    )),
  ]));
}

const GROUPS = {
  text: groupText, heading: groupHeading, type: groupType, chrome: groupChrome,
  north: groupNorth, scale: groupScale, neatline: groupNeatline,
  inset: groupInset, legend: groupLegend, logo: groupLogo,
};

function groupPosition(elm) {
  const num = (key, label, max) => {
    const input = el('input.field', { type: 'number', step: '0.5', value: elm[key], min: -20, max });
    input.addEventListener('change', () => {
      updateElement(elm.id, { [key]: Number(input.value) });
      renderElements();
    });
    return labelled(label, input);
  };
  return section('Position & size', el('div.insp-grid', {}, [
    num('x', 'Left %', 110), num('y', 'Top %', 110),
    num('w', 'Width %', 120), num('h', 'Height %', 120),
  ]));
}

function elementInspector(elm) {
  const def = ELEMENT_TYPES[elm.type];
  const groups = (def?.inspect ?? []).map((key) => GROUPS[key]?.(elm)).filter(Boolean);

  return [
    head(elementLabel(elm), def?.hint),
    section('', inline([
      button(elm.hidden ? 'Show' : 'Hide', () => {
        checkpoint(); elm.hidden = !elm.hidden; touch('elements'); renderElements(); renderInspector();
      }, 'ghost'),
      button(elm.locked ? 'Unlock' : 'Lock', () => {
        checkpoint(); elm.locked = !elm.locked; touch('elements'); renderElements(); renderInspector();
      }, 'ghost'),
      button('Duplicate', () => { duplicateElement(elm.id); renderElements(); }, 'ghost'),
      button('Delete', () => { removeElement(elm.id); renderElements(); }, 'ghost'),
    ], '5px')),
    ...groups,
    groupPosition(elm),
  ];
}

/* ================================================================== */
/* layer inspector                                                     */
/* ================================================================== */
function layerInspector(layer) {
  const s = layer.style ?? {};
  const setStyle = (patch, redraw = true) => {
    updateLayer(layer.id, { style: patch });
    if (redraw) renderElements();
  };
  const expressionFill = typeof s.fill !== 'string';

  const labelFields = layer.geojson ? ['', ...propertyKeys(layer.geojson, 30)] : [''];

  return [
    head(layer.name, layer.meta?.description || 'Layer styling'),
    section('', inline([
      button('Zoom to', () => layer.bbox && flyToBounds(boundsFromBbox(layer.bbox)), 'ghost'),
      button('Remove', () => { removeLayer(layer.id); set({ selectedLayerId: null }, { history: false }); renderElements(); }, 'ghost'),
    ], '5px')),

    section('Name', textInput(layer.name, (value) => { updateLayer(layer.id, { name: value }); })),

    layer.type === 'raster'
      ? section('Raster', inspectorRow('Opacity', slider({ min: 0, max: 1, step: 0.05, value: layer.opacity ?? 0.85 }, (v) => {
          updateLayer(layer.id, { opacity: v });
        })))
      : section('Appearance', stack([
          expressionFill
            ? el('p', {
                style: { margin: 0, fontSize: '10.5px', color: '#94a3b8', lineHeight: '1.45' },
                text: 'This layer colours each feature from its own analysis class, so a single fill colour does not apply.',
              })
            : inline([
                colorInput(s.fill, (value) => setStyle({ fill: value, stroke: shade(value, -0.25) })),
                el('span', { text: 'Fill colour', style: { fontSize: '11.5px', color: '#475569', flex: '1' } }),
              ]),
          layer.kind === 'polygon'
            ? inspectorRow('Fill opacity', slider({ min: 0, max: 1, step: 0.05, value: s.fillOpacity ?? 0.35 }, (v) => setStyle({ fillOpacity: v })))
            : null,
          expressionFill ? null : inline([
            colorInput(s.stroke, (value) => setStyle({ stroke: value })),
            el('span', { text: 'Outline colour', style: { fontSize: '11.5px', color: '#475569', flex: '1' } }),
          ]),
          inspectorRow('Outline width', slider({ min: 0, max: 8, step: 0.2, value: s.strokeWidth ?? 1.2 }, (v) => setStyle({ strokeWidth: v }))),
          layer.kind === 'point'
            ? inspectorRow('Point size', slider({ min: 1, max: 16, step: 0.5, value: s.radius ?? 4 }, (v) => setStyle({ radius: v })))
            : null,
          layer.kind !== 'point' ? labelled('Line style', seg(
            [{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }],
            s.dash ?? 'solid', (value) => setStyle({ dash: value }),
          )) : null,
          inspectorRow('Layer opacity', slider({ min: 0, max: 1, step: 0.05, value: layer.opacity ?? 1 }, (v) => {
            updateLayer(layer.id, { opacity: v });
          })),
        ])),

    layer.geojson ? section('Labels', stack([
      labelled('Label features with', select(
        labelFields.map((k) => ({ value: k, label: k || 'No labels' })),
        s.labelField ?? '', (value) => setStyle({ labelField: value }),
      )),
      s.labelField ? inspectorRow('Label size', slider({ min: 6, max: 24, step: 1, value: s.labelSize ?? 11 }, (v) => setStyle({ labelSize: v }))) : null,
    ])) : null,

    layer.source === 'analysis' ? section('Palette', stack([
      el('p', {
        style: { margin: 0, fontSize: '10.5px', color: '#94a3b8', lineHeight: '1.45' },
        text: 'Analysis colours come from the job definition so the legend always matches the map.',
      }),
    ])) : null,
  ];
}

/* ================================================================== */
/* page setup (nothing selected)                                       */
/* ================================================================== */
function pageInspector() {
  const paper = PAPER_SIZES[state.page.size] ?? PAPER_SIZES.a4;
  const fixed = Boolean(paper.fixedOrientation);
  const update = (patch) => {
    set({ page: { ...state.page, ...patch } });
    layoutArtboard();
    renderElements();
    renderInspector();
  };

  return [
    head('Page setup', 'Nothing selected — click an element on the page to edit it.'),
    section('Paper', stack([
      labelled('Size', select(
        Object.entries(PAPER_SIZES).map(([value, p]) => ({ value, label: `${p.label} · ${p.wIn}″ × ${p.hIn}″` })),
        state.page.size, (value) => update({ size: value }),
      )),
      labelled('Orientation', seg(
        [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }],
        fixed ? paper.fixedOrientation : state.page.orientation,
        (value) => update({ orientation: value }),
      ), fixed ? `${paper.label} is always ${paper.fixedOrientation}.` : ''),
      labelled('Export quality', seg(
        [{ value: 96, label: 'Screen' }, { value: 150, label: 'Standard' }, { value: 300, label: 'Print' }],
        state.page.dpi, (value) => update({ dpi: Number(value) }),
      )),
      inspectorRow('Page background', colorInput(state.page.background ?? '#ffffff', (value) => {
        set({ page: { ...state.page, background: value } }, { history: false });
      })),
    ])),
    section('Tips', el('div', { style: { fontSize: '11.5px', color: '#475569', lineHeight: '1.55' } }, [
      el('p', { style: { margin: '0 0 6px' }, html: 'Drag any element inside the dashed page frame. Pink lines show when it lines up with the page or another element.' }),
      el('p', { style: { margin: '0 0 6px' }, html: 'Hold <b>Alt</b> while dragging to ignore snapping, <b>Shift</b> + arrow keys to nudge further.' }),
      el('p', { style: { margin: 0 }, html: 'Whatever sits inside the frame is exactly what gets exported.' }),
    ])),
  ];
}

/* ================================================================== */
export function renderInspector() {
  panel = panel ?? $('#right-panel');
  if (!panel) return;

  const elm = state.elements.find((e) => e.id === state.selectedElementId);
  if (elm) return void fill(panel, elementInspector(elm));

  const layer = state.layers.find((l) => l.id === state.selectedLayerId);
  if (layer) return void fill(panel, layerInspector(layer));

  fill(panel, pageInspector());
}

export function initInspector() {
  panel = $('#right-panel');
  renderInspector();
  // Only the selection rebuilds this panel. Style edits made *inside* it
  // fire `elements`/`layers` on every slider frame — rebuilding then would
  // yank the control out from under the pointer, so those paths call
  // renderInspector() explicitly when they actually need to.
  // `elements` and `layers` are deliberately absent: style edits made in
  // this panel fire them on every slider frame, and rebuilding then would
  // yank the control out from under the pointer. Those paths call
  // renderInspector() explicitly when the panel's shape actually changes.
  subscribe(['selectedElementId', 'selectedLayerId', 'page', 'templateId', 'studyArea'], renderInspector);
}
