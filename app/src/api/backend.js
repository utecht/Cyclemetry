/**
 * Backend API — all calls go through Tauri invoke() to native Rust commands.
 */

// ─── Response types ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} TemplateListItem
 * @property {string} id - filename, e.g. "my_template.json"
 * @property {string} name - display name
 * @property {'user'|'community'|'community-modified'} type
 * @property {string|null} preview_url
 */

/**
 * @typedef {Object} RenderProgress
 * @property {number} frames_rendered
 * @property {number} total_frames
 * @property {number} fraction - 0–1
 * @property {boolean} is_running
 * @property {string|null} error
 */

/**
 * @typedef {Object} ElementBounds
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * @typedef {Object} DemoFrame
 * @property {string} image - data:image/png;base64,… PNG of the rendered frame
 * @property {ElementBounds[]} elements
 * @property {string|null} warning
 */

/**
 * @typedef {Object} RenderStarted
 * @property {'started'} status
 * @property {string} output_path
 */

/**
 * @typedef {Object} DistanceInfo
 * @property {number} total_m - total activity distance in metres
 * @property {number} overlay_start_m - distance at overlay start in metres
 * @property {number} overlay_end_m - distance at overlay end in metres
 */

/**
 * @typedef {Object} MetricRange
 * @property {string} metric
 * @property {number} min
 * @property {number} max
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core'

async function invoke(cmd, args = {}) {
  const result = await tauriInvoke(cmd, args)
  // Commands that return JSON strings need parsing; typed returns pass through as-is.
  if (typeof result === 'string') {
    try {
      return JSON.parse(result)
    } catch {
      return result
    }
  }
  return result
}

// ─── Build info ───────────────────────────────────────────────────────────────

/** @returns {Promise<string>} */
export const appBuildInfo = () => invoke('app_build_info')

// ─── Templates ────────────────────────────────────────────────────────────────

/** @returns {Promise<TemplateListItem[]>} */
export const listTemplates = () => invoke('backend_list_templates')

/**
 * @param {string} filename
 * @returns {Promise<import('./elementTypes.js').Template>}
 */
export const getTemplate = (filename) =>
  invoke('backend_get_template', { filename })

/**
 * @param {string} filename
 * @param {import('./elementTypes.js').Template} config
 * @returns {Promise<void>}
 */
export const saveTemplate = (filename, config) =>
  invoke('backend_save_template', { filename, config })

/**
 * @param {string} from
 * @param {string} to
 * @returns {Promise<void>}
 */
export const renameTemplate = (from, to) =>
  invoke('backend_rename_template', { from, to })

/** @returns {Promise<void>} */
export const openTemplatesFolder = () => invoke('backend_open_templates')

// ─── Fonts ────────────────────────────────────────────────────────────────────

/** @returns {Promise<string[]>} */
export const listFonts = () => invoke('backend_list_fonts')

/**
 * @param {string} path
 * @returns {Promise<void>}
 */
export const importFont = (path) => invoke('backend_import_font', { path })

/** @returns {Promise<void>} */
export const openActivitiesFolder = () => invoke('backend_open_activities')

// ─── File system ──────────────────────────────────────────────────────────────

/**
 * @param {string} [dir]
 * @returns {Promise<void>}
 */
export const openDownloads = (dir) =>
  invoke('backend_open_downloads', { path: dir ?? null })

/** @returns {Promise<string>} */
export const defaultOutputDir = () => invoke('backend_default_output_dir')

/**
 * @param {string} filename
 * @returns {Promise<void>}
 */
export const openVideo = (filename) =>
  invoke('backend_open_video', { filename })

// ─── GPX ─────────────────────────────────────────────────────────────────────

/**
 * @param {string} path
 * @returns {Promise<string>} gpx filename stored in the uploads dir
 */
export const loadGpxFromPath = (path) => invoke('backend_load_gpx', { path })

/**
 * @param {string} gpxFilename
 * @param {number} sceneStart
 * @param {number} sceneEnd
 * @returns {Promise<DistanceInfo>}
 */
export const getActivityDistanceInfo = (gpxFilename, sceneStart, sceneEnd) =>
  invoke('backend_activity_distance_info', {
    gpxFilename,
    sceneStart,
    sceneEnd,
  })

/**
 * @param {string} gpxFilename
 * @param {string} metric
 * @param {string} [unit]
 * @param {number} sceneStart
 * @param {number} sceneEnd
 * @returns {Promise<MetricRange>}
 */
export const getActivityMetricRange = (
  gpxFilename,
  metric,
  unit,
  sceneStart,
  sceneEnd,
) =>
  invoke('backend_activity_metric_range', {
    gpxFilename,
    metric,
    unit: unit ?? null,
    sceneStart,
    sceneEnd,
  })

/**
 * @param {File} file
 * @returns {Promise<string>} stored gpx filename
 */
export async function uploadGpx(file) {
  const buffer = await file.arrayBuffer()
  const fileData = Array.from(new Uint8Array(buffer))
  return invoke('backend_upload', { fileData, filename: file.name })
}

// ─── Community templates ──────────────────────────────────────────────────────

/** @returns {Promise<TemplateListItem[]>} */
export const fetchCommunityTemplates = () =>
  invoke('backend_community_templates')

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export const installCommunityTemplate = (id) =>
  invoke('backend_install_community_template', { id })

/**
 * @param {string} filename
 * @returns {Promise<void>}
 */
export const deleteTemplate = (filename) =>
  invoke('backend_delete_template', { filename })

/**
 * @param {string} filename
 * @param {string} imageDataUrl
 * @returns {Promise<void>}
 */
export const saveTemplatePreview = (filename, imageDataUrl) =>
  invoke('backend_save_template_preview', { filename, imageDataUrl })

// ─── Native Rust renderer ─────────────────────────────────────────────────────

/**
 * @param {import('./elementTypes.js').Template} config
 * @param {string} gpxFilename
 * @param {number} frameIndex
 * @param {number} previewFps
 * @param {number} [targetWidth]
 * @param {number} [targetHeight]
 * @returns {Promise<DemoFrame>}
 */
export const nativeGenerateDemo = (
  config,
  gpxFilename,
  frameIndex,
  previewFps,
  targetWidth,
  targetHeight,
) =>
  invoke('native_demo', {
    config,
    gpxFilename,
    frameIndex,
    previewFps,
    targetWidth,
    targetHeight,
  })

/**
 * @param {import('./elementTypes.js').Template} config
 * @param {string} gpxFilename
 * @param {string} [outputDir]
 * @param {number} [targetWidth]
 * @param {number} [targetHeight]
 * @returns {Promise<RenderStarted>}
 */
export const nativeStartRender = (
  config,
  gpxFilename,
  outputDir,
  targetWidth,
  targetHeight,
) =>
  invoke('native_render', {
    config,
    gpxFilename,
    outputDir: outputDir ?? null,
    targetWidth: targetWidth ?? null,
    targetHeight: targetHeight ?? null,
  })

/** @returns {Promise<RenderProgress>} */
export const nativeGetProgress = () => invoke('native_progress')

/** @returns {Promise<void>} */
export const nativeCancelRender = () => invoke('native_cancel')

/**
 * @param {import('./elementTypes.js').Template} config
 * @param {string} gpxFilename
 * @param {number} frames
 * @param {number} [targetWidth]
 * @param {number} [targetHeight]
 * @returns {Promise<unknown>}
 */
export const nativeBenchmark = (
  config,
  gpxFilename,
  frames,
  targetWidth,
  targetHeight,
) =>
  invoke('native_benchmark', {
    config,
    gpxFilename,
    frames,
    targetWidth: targetWidth ?? null,
    targetHeight: targetHeight ?? null,
  })

// ─── Assets ──────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AssetItem
 * @property {string} name - filename e.g. "bolt.svg"
 * @property {string} data_url - base64 data URL for the image
 */

/** @returns {Promise<AssetItem[]>} */
export const listAssets = () => invoke('backend_list_assets')

/**
 * @param {string} path - absolute path to source file on disk
 * @returns {Promise<string>} filename stored in user assets dir
 */
export const importAsset = (path) => invoke('backend_import_asset', { path })

/**
 * @param {string} filename - asset filename (e.g. "bolt.svg")
 * @returns {Promise<{width: number, height: number}>}
 */
export const imageSize = (filename) =>
  invoke('backend_image_size', { filename })

// ─── Recent GPX ──────────────────────────────────────────────────────────────

/**
 * @param {string} path
 * @returns {Promise<void>}
 */
export const recordGpxOpened = (path) => invoke('record_gpx_opened', { path })
