import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatTime(seconds) {
  if (seconds == null || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatHomePath(path) {
  if (!path) return ''
  const macHome = path.match(/^\/Users\/([^/]+)/)
  if (macHome) return path.replace(`/Users/${macHome[1]}`, '~')
  const windowsHome = path.match(/^[A-Za-z]:\\Users\\[^\\]+/)
  if (windowsHome) return path.replace(windowsHome[0], '~')
  return path
}

function formatFileSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

export function exportBitsPerPixelSecond(
  bytes,
  width,
  height,
  fps,
  durationSecs,
) {
  const denominator = width * height * fps * durationSecs
  if (!(bytes > 0) || !(denominator > 0)) return null
  return (bytes * 8) / denominator
}

// Midpoint guess for never-rendered sparse cycling overlays on ProRes 4444.
// Real content lives in a wide band (~0.25–0.8); after a single render the
// calibrated value supersedes this.
const DEFAULT_BITS_PER_PIXEL_SECOND = 0.5

// ProRes 4444 is content-dependent, but a wide range is more noise than signal
// in a tooltip — return a single best-guess number and let calibration sharpen
// it as renders accumulate. `calibration` is { bps, n } or null.
export function estimateProResFileSize(
  width,
  height,
  fps,
  durationSecs,
  calibration = null,
) {
  const pixelsPerExport = width * height * fps * durationSecs
  if (!(pixelsPerExport > 0)) return null
  const bps =
    calibration?.bps > 0 ? calibration.bps : DEFAULT_BITS_PER_PIXEL_SECOND
  return `~${formatFileSize((pixelsPerExport * bps) / 8)}`
}

export function parseLocalStorage(key, fallback = null) {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : fallback
  } catch {
    return fallback
  }
}
