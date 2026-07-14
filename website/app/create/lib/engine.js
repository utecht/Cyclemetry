// Thin JS wrapper over the Emscripten build of the native render pipeline
// (src-tauri/render-wasm). One global session lives inside the wasm module, so
// this module owns it too: load once, re-init whenever the ride, template or
// output size changes.

const MODULE_URL = '/wasm/cyclemetry_render.js'

let modulePromise = null

export function loadEngine() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const url = new URL(MODULE_URL, window.location.origin).href
      const factory = (await import(/* webpackIgnore: true */ url)).default
      return factory()
    })()
  }
  return modulePromise
}

function pushBytes(mod, bytes) {
  const ptr = mod._cm_alloc(bytes.byteLength)
  mod.HEAPU8.set(bytes, ptr)
  return ptr
}

function lastError(mod) {
  const ptr = mod._cm_last_error()
  return ptr ? mod.UTF8ToString(ptr) : 'unknown render engine error'
}

export function writeFile(mod, path, bytes) {
  const pathBytes = new TextEncoder().encode(path)
  const pathPtr = pushBytes(mod, pathBytes)
  const dataPtr = pushBytes(mod, bytes)
  const rc = mod._cm_write_file(pathPtr, pathBytes.length, dataPtr, bytes.byteLength)
  mod._cm_free(pathPtr, pathBytes.length)
  mod._cm_free(dataPtr, bytes.byteLength)
  if (rc !== 0) throw new Error(lastError(mod))
}

/** Parse template + activity and build the scene. Empty gpxPath = demo ride. */
export function initSession(mod, templateText, gpxPath, outW, outH) {
  const tpl = new TextEncoder().encode(templateText)
  const gpx = new TextEncoder().encode(gpxPath)
  const tplPtr = pushBytes(mod, tpl)
  const gpxPtr = pushBytes(mod, gpx)
  const rc = mod._cm_init(tplPtr, tpl.length, gpxPtr, gpx.length, outW, outH)
  mod._cm_free(tplPtr, tpl.length)
  mod._cm_free(gpxPtr, gpx.length)
  if (rc !== 0) throw new Error(lastError(mod))
  return {
    width: mod._cm_width(),
    height: mod._cm_height(),
    fps: mod._cm_fps() || 30,
    frameCount: mod._cm_frame_count(),
  }
}

/**
 * Render one overlay frame into `imageData` (which must match the session's
 * dimensions). The pipeline emits premultiplied BGRA — what FFmpeg wants on
 * desktop — while putImageData wants straight-alpha RGBA, so undo both here.
 */
export function renderOverlayFrame(mod, frameIdx, imageData) {
  const w = mod._cm_width()
  const h = mod._cm_height()
  const ptr = mod._cm_render(frameIdx)
  if (!ptr) throw new Error(lastError(mod))

  const src = mod.HEAPU8.subarray(ptr, ptr + w * h * 4)
  const dst = imageData.data
  for (let i = 0; i < dst.length; i += 4) {
    const a = src[i + 3]
    if (a === 0 || a === 255) {
      dst[i] = src[i + 2]
      dst[i + 1] = src[i + 1]
      dst[i + 2] = src[i]
    } else {
      dst[i] = Math.min(255, (src[i + 2] * 255) / a)
      dst[i + 1] = Math.min(255, (src[i + 1] * 255) / a)
      dst[i + 2] = Math.min(255, (src[i] * 255) / a)
    }
    dst[i + 3] = a
  }
  return imageData
}

/**
 * Time the overlay to a background clip: the template's scene sweeps the whole
 * ride in `target_duration` seconds, so setting it to the clip length makes the
 * two line up without asking the user to trim anything.
 */
export function retimeTemplate(templateText, durationSeconds) {
  const template = JSON.parse(templateText)
  if (durationSeconds) {
    template.scene = { ...template.scene, target_duration: durationSeconds }
  }
  return JSON.stringify(template)
}
