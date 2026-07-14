// Client-side PNG export: one frame of the same composite the mp4 export walks —
// background frame under the overlay frame that's due at that point on the
// timeline — encoded straight off a canvas.

import { renderOverlayFrame } from './engine'
import { compositeFrame } from './background'
import { overlayFrameAt } from './timeline'

/**
 * Render output frame `frame` and return it as a PNG Blob. Same frame the
 * preview shows at that playhead position, at full output resolution.
 */
export async function exportPng({ mod, timeline, background, frame }) {
  const { width, height, fps } = timeline

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')

  const overlayIdx = overlayFrameAt(timeline, frame)
  let overlayCanvas = null
  if (overlayIdx >= 0) {
    const pixels = new ImageData(width, height)
    renderOverlayFrame(mod, overlayIdx, pixels)
    overlayCanvas = new OffscreenCanvas(width, height)
    overlayCanvas.getContext('2d').putImageData(pixels, 0, 0)
  }

  const sample =
    background?.kind === 'video' ? await background.sink.getSample(frame / fps) : null
  compositeFrame(ctx, width, height, background, sample, overlayCanvas)
  sample?.close()

  return canvas.convertToBlob({ type: 'image/png' })
}
