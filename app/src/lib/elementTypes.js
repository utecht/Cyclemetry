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
]

/**
 * List/handle display metadata for an element instance.
 * `kind` is a display discriminant ('map' splits out of 'plot' for icons).
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
  // plot
  if (el.value === 'course')
    return { icon: 'map', name: 'map', kind: 'map', unit: null }
  return { icon: 'bar', name: `${el.value} chart`, kind: 'plot', unit: null }
}

/** Human label for the properties-panel header / status bar. */
export function elementTypeName(el) {
  if (el?.type === 'label') return 'Text Label'
  if (el?.type === 'value') return 'Metric Value'
  if (el?.type === 'meter') return 'Fill Meter'
  if (el?.type === 'gauge') return 'Gauge'
  if (el?.type === 'rect') return 'Rectangle'
  return el?.value === 'course' ? 'Map' : 'Chart'
}
