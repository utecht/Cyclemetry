/**
 * Scalar fields whose value, when equal to this, carries no information —
 * the Rust renderer produces identical output with or without the field.
 * Source: src-tauri/src/render/frame.rs unwrap_or() call sites.
 */
const SCALAR_DEFAULTS = {
  opacity: 1,
  rotation: 0,
  italic: false,
  remove_edge_color: false,
  hide_track: false,
  // gauge
  start_angle: 135,
  sweep_angle: 270,
  background_margin: 0,
  // meter + rect
  radius: 0,
  // meter
  segments: 0,
  gap: 0,
  scale_ticks: 0,
}

/** Array-valued fields where an empty array is equivalent to absent. */
const EMPTY_ARRAY_DEFAULTS = new Set()

/**
 * Fields that are always stripped from the saved JSON regardless of value.
 * These are editor-only caches derivable from the source file at load time.
 */
const STRIP_ALWAYS = new Set(['natural_width', 'natural_height'])

/**
 * Recursively strip default-valued fields from an element or its sub-objects.
 * Creates a new object — does not mutate the input.
 */
function stripObj(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (STRIP_ALWAYS.has(k)) continue
    if (
      Object.prototype.hasOwnProperty.call(SCALAR_DEFAULTS, k) &&
      v === SCALAR_DEFAULTS[k]
    )
      continue
    if (Array.isArray(v)) {
      if (EMPTY_ARRAY_DEFAULTS.has(k) && v.length === 0) continue
      out[k] = v.map((item) =>
        item !== null && typeof item === 'object' ? stripObj(item) : item,
      )
    } else if (v !== null && typeof v === 'object') {
      const stripped = stripObj(v)
      if (Object.keys(stripped).length > 0) out[k] = stripped
    } else {
      out[k] = v
    }
  }
  return out
}

function stripSceneDefaults(scene) {
  if (!scene) return scene
  const out = { ...scene }
  if (out.fps === 30) delete out.fps
  if (out.vars && Object.keys(out.vars).length === 0) delete out.vars
  // start/end are activity-specific timeline bounds, not template config.
  // Strip them so templates stay GPX-agnostic and always open at the full
  // activity range when loaded.
  delete out.start
  delete out.end
  return out
}

/**
 * Return a cleaned copy of `config` with default-valued fields removed.
 * The live in-memory config is never mutated — only the version written to disk
 * is cleaned. Rendering is identical before and after stripping.
 */
export function stripDefaults(config) {
  if (!config) return config
  return {
    ...config,
    scene: stripSceneDefaults(config.scene),
    elements: (config.elements ?? []).map(stripObj),
  }
}
