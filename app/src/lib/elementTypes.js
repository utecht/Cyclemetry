/**
 * Element-type registry. The single place that knows about element kinds.
 *
 * Adding a new graphic = one new ADD_PRESETS entry + a branch in
 * `elementMeta`/`elementTypeName` here, plus its Rust `OverlayElement` impl.
 * No edits scattered across appState / list / inspector.
 *
 * Element `type` tokens match the Rust serde tag exactly: 'label' | 'value'
 * | 'plot'. Icon tokens are resolved to components by the consuming view.
 */

// ─── Sub-config types ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} LineConfig
 * @property {number} [width]
 * @property {string} [color]
 * @property {number} [past_opacity]
 * @property {number} [future_opacity]
 */

/**
 * @typedef {Object} FillConfig
 * @property {number} [opacity]
 * @property {string} [color]
 */

/**
 * @typedef {Object} PointConfig
 * @property {string} [color]
 * @property {number} [weight]
 * @property {number} [opacity]
 * @property {string} [edge_color]
 * @property {number} [edge_width]
 * @property {boolean} [remove_edge_color]
 */

/**
 * @typedef {Object} PointLabelConfig
 * @property {number} [font_size]
 * @property {string} [color]
 * @property {string} [font]
 * @property {boolean} [italic]
 * @property {number} [x_offset]
 * @property {number} [y_offset]
 * @property {string[]} [units]
 * @property {number} [decimal_rounding]
 */

// ─── Scene / Template ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} GroupConfig
 * @property {string} id
 * @property {string} name
 * @property {string[]} element_ids
 */

/**
 * @typedef {Object} SceneConfig
 * @property {number} width
 * @property {number} height
 * @property {number} fps
 * @property {number} [font_size]
 * @property {string} [font]
 * @property {string} [overlay_filename]
 * @property {number} [start]
 * @property {number} [end]
 * @property {number} [decimal_rounding]
 * @property {string} [color]
 * @property {number} [opacity]
 * @property {string[]} [layers]
 * @property {GroupConfig[]} [groups]
 */

/**
 * @typedef {Object} Template
 * @property {SceneConfig} scene
 * @property {Element[]} elements
 */

// ─── Element variants ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} LabelElement
 * @property {'label'} type
 * @property {string} id
 * @property {string} text
 * @property {number} x
 * @property {number} y
 * @property {number} [font_size]
 * @property {string} [font]
 * @property {boolean} [italic]
 * @property {string} [color]
 * @property {number} [opacity]
 * @property {number} [decimal_rounding]
 * @property {'left'|'center'|'right'} [text_align]
 */

/**
 * @typedef {Object} ValueElement
 * @property {'value'} type
 * @property {string} id
 * @property {string} value
 * @property {number} x
 * @property {number} y
 * @property {number} [font_size]
 * @property {string} [font]
 * @property {boolean} [italic]
 * @property {string} [color]
 * @property {number} [opacity]
 * @property {string} [unit]
 * @property {string} [suffix]
 * @property {number} [decimal_rounding]
 * @property {number} [hours_offset]
 * @property {string} [time_format]
 * @property {'overlay_start'|'activity_start'|'overlay_end'|'activity_end'|'custom'} [distance_reference]
 * @property {number} [distance_target]
 * @property {'left'|'center'|'right'} [text_align]
 */

/**
 * @typedef {Object} PlotElement
 * @property {'plot'} type
 * @property {string} id
 * @property {string} value
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} [dpi]
 * @property {string} [color]
 * @property {number} [opacity]
 * @property {LineConfig} [line]
 * @property {FillConfig} [fill]
 * @property {number} [margin]
 * @property {PointConfig[]} [points]
 * @property {PointLabelConfig} [point_label]
 * @property {number} [rotation]
 */

/**
 * @typedef {Object} MeterElement
 * @property {'meter'} type
 * @property {string} id
 * @property {string} value
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} min
 * @property {number} max
 * @property {'up'|'down'|'left'|'right'} [direction]
 * @property {string} [unit]
 * @property {string} [color]
 * @property {string[]} [gradient]
 * @property {string} [background]
 * @property {number} [background_opacity]
 * @property {number} [fill_opacity]
 * @property {number} [opacity]
 * @property {number} [radius]
 * @property {number} [segments]
 * @property {number} [gap]
 * @property {number} [rotation]
 * @property {string} [border_color]
 * @property {number} [border_width]
 * @property {number} [border_opacity]
 * @property {number[]} [scale_labels]
 * @property {string} [scale_color]
 * @property {number} [scale_font_size]
 * @property {string} [scale_font]
 * @property {number} [scale_offset]
 * @property {number} [scale_tick_length]
 * @property {number} [scale_tick_width]
 * @property {string} [scale_suffix]
 * @property {number} [scale_ticks]
 */

/**
 * @typedef {Object} GaugeElement
 * @property {'gauge'} type
 * @property {string} id
 * @property {string} value
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} min
 * @property {number} max
 * @property {string} [unit]
 * @property {number} [start_angle]
 * @property {number} [sweep_angle]
 * @property {string} [color]
 * @property {string} [arc_color]
 * @property {number} [arc_width]
 * @property {string} [progress_color]
 * @property {string[]} [gradient]
 * @property {string} [needle_color]
 * @property {number} [needle_width]
 * @property {string} [cap_color]
 * @property {number} [cap_radius]
 * @property {string} [background_color]
 * @property {number} [background_opacity]
 * @property {number} [background_margin]
 * @property {boolean} [hide_track]
 * @property {number} [opacity]
 * @property {number} [rotation]
 */

/**
 * @typedef {Object} RectElement
 * @property {'rect'} type
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {string} [color]
 * @property {number} [opacity]
 * @property {number} [fill_opacity]
 * @property {string} [border_color]
 * @property {number} [border_width]
 * @property {number} [border_opacity]
 * @property {number} [radius]
 * @property {number} [rotation]
 */

/**
 * @typedef {Object} ImageElement
 * @property {'image'} type
 * @property {string} id
 * @property {string} file
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} [opacity]
 * @property {number} [rotation]
 * @property {string} [pulse_metric]
 * @property {number} [pulse_bpm]
 * @property {number} [pulse_amplitude]
 */

/**
 * Any overlay element. Discriminated union on the `type` field.
 * @typedef {LabelElement|ValueElement|PlotElement|MeterElement|GaugeElement|RectElement|ImageElement} Element
 */

/**
 * @typedef {Object} ElementMeta
 * @property {string} icon
 * @property {string} name
 * @property {'label'|'value'|'plot'|'map'|'meter'|'gauge'|'rect'|'image'} kind
 * @property {string|null} unit
 */

export const ADD_PRESETS = [
  {
    key: 'label',
    type: 'label',
    icon: 'type',
    title: 'Add text label',
    defaults: (scene) => ({
      text: 'LABEL',
      x: 100,
      y: 100,
      font_size: scene?.font_size ?? 32,
      italic: false,
      color: '#ffffff',
      opacity: 1,
    }),
  },
  {
    key: 'value',
    type: 'value',
    icon: 'hash',
    title: 'Add metric value',
    defaults: (scene) => ({
      value: 'speed',
      x: 100,
      y: 200,
      font_size: scene?.font_size ?? 48,
      italic: false,
      opacity: 1,
    }),
  },
  {
    key: 'chart',
    type: 'plot',
    icon: 'bar',
    title: 'Add chart',
    defaults: () => ({
      value: 'elevation',
      x: 50,
      y: 800,
      width: 500,
      height: 120,
      opacity: 1,
      line: { color: '#ffffff', width: 1.5 },
      fill: { opacity: 0.25, color: '#ffffff' },
      points: [{ color: '#ffffff', weight: 80, remove_edge_color: true }],
    }),
  },
  {
    key: 'map',
    type: 'plot',
    icon: 'map',
    title: 'Add map (GPS route)',
    defaults: () => ({
      value: 'course',
      x: 50,
      y: 580,
      width: 200,
      height: 200,
      opacity: 1,
      line: { color: '#ffffff', width: 1.5 },
      points: [{ color: '#ef4444', weight: 80, edge_color: '#ffffff' }],
    }),
  },
  {
    key: 'meter',
    type: 'meter',
    icon: 'meter',
    title: 'Add fill meter',
    defaults: () => ({
      value: 'speed',
      x: 80,
      y: 300,
      width: 60,
      height: 400,
      min: 0,
      max: 60,
      direction: 'up',
      color: '#ffffff',
      fill_opacity: 1,
      background: '#ffffff',
      background_opacity: 0.2,
      opacity: 1,
      radius: 8,
    }),
  },
  {
    key: 'gauge',
    type: 'gauge',
    icon: 'gauge',
    title: 'Add gauge (dial)',
    defaults: () => ({
      value: 'speed',
      x: 80,
      y: 300,
      width: 360,
      height: 360,
      min: 0,
      max: 60,
      start_angle: 135,
      sweep_angle: 270,
      color: '#ffffff',
      arc_color: '#ffffff55',
      arc_width: 14,
      progress_color: '#ffffff',
      needle_color: '#ef4444',
      needle_width: 6,
      opacity: 1,
    }),
  },
  {
    key: 'rect',
    type: 'rect',
    icon: 'rect',
    title: 'Add rectangle',
    defaults: () => ({
      x: 100,
      y: 100,
      width: 300,
      height: 200,
      color: '#ffffff',
      fill_opacity: 0.3,
      opacity: 1,
      radius: 0,
    }),
  },
  {
    key: 'image',
    type: 'image',
    icon: 'image',
    title: 'Add image',
    defaults: () => ({
      file: '',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      opacity: 1,
    }),
  },
]

/**
 * List/handle display metadata for an element instance.
 * `kind` is a display discriminant ('map' splits out of 'plot' for icons).
 * @param {Element|null|undefined} el
 * @returns {ElementMeta}
 */
export function elementMeta(el) {
  if (!el) return { icon: 'bar', name: '', kind: 'plot', unit: null }
  if (el.type === 'label')
    return { icon: 'type', name: el.text || 'Label', kind: 'label', unit: null }
  if (el.type === 'value')
    return {
      icon: 'hash',
      name: el.value || 'value',
      kind: 'value',
      unit: el.unit ?? null,
    }
  if (el.type === 'meter')
    return {
      icon: 'meter',
      name: `${el.value || 'value'} meter`,
      kind: 'meter',
      unit: el.unit ?? null,
    }
  if (el.type === 'gauge')
    return {
      icon: 'gauge',
      name: `${el.value || 'value'} gauge`,
      kind: 'gauge',
      unit: el.unit ?? null,
    }
  if (el.type === 'rect')
    return { icon: 'rect', name: 'rectangle', kind: 'rect', unit: null }
  if (el.type === 'image')
    return {
      icon: 'image',
      name: el.file || 'image',
      kind: 'image',
      unit: null,
    }
  // plot
  if (el.value === 'course')
    return { icon: 'map', name: 'map', kind: 'map', unit: null }
  return { icon: 'bar', name: `${el.value} chart`, kind: 'plot', unit: null }
}

/**
 * Human label for the properties-panel header / status bar.
 * @param {Element|null|undefined} el
 * @returns {string}
 */
export function elementTypeName(el) {
  if (el?.type === 'label') return 'Text Label'
  if (el?.type === 'value') return 'Metric Value'
  if (el?.type === 'meter') return 'Fill Meter'
  if (el?.type === 'gauge') return 'Gauge'
  if (el?.type === 'rect') return 'Rectangle'
  if (el?.type === 'image') return 'Image'
  return el?.value === 'course' ? 'Map' : 'Chart'
}
