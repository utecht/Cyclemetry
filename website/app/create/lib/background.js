// Background media (photo or clip) that the overlay is composited onto.
//
// Video is read with mediabunny rather than a <video> element: the same
// random-access decode powers both preview scrubbing and the export loop, and
// it hands back frames with rotation already applied.

/** Longest clip we'll take — an in-browser encode has to stay finite. */
export const MAX_CLIP_SECONDS = 60

export async function loadBackground(file) {
  if (file.type.startsWith('image/')) {
    const bitmap = await createImageBitmap(file)
    return {
      kind: 'image',
      name: file.name,
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
    }
  }
  if (!file.type.startsWith('video/')) {
    throw new Error(`${file.name} is neither an image nor a video`)
  }

  const { Input, BlobSource, ALL_FORMATS, VideoSampleSink } = await import('mediabunny')
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  })
  const track = await input.getPrimaryVideoTrack()
  if (!track) throw new Error(`${file.name} has no video track`)
  if (!(await track.canDecode())) {
    throw new Error(`this browser can't decode ${track.codec ?? 'that'} video`)
  }

  const fullDuration = await input.computeDuration()
  return {
    kind: 'video',
    name: file.name,
    file,
    input,
    track,
    sink: new VideoSampleSink(track),
    fullDuration,
    duration: Math.min(fullDuration, MAX_CLIP_SECONDS),
    width: track.displayWidth,
    height: track.displayHeight,
  }
}

export function releaseBackground(bg) {
  if (bg?.kind === 'image') bg.bitmap.close()
  if (bg?.kind === 'video') bg.input.dispose?.()
}

/**
 * Draw a frame source so it covers the whole canvas, center-cropped — the
 * overlay's aspect ratio wins, the clip fills behind it.
 */
export function drawCover(ctx, source, srcW, srcH, w, h) {
  const scale = Math.max(w / srcW, h / srcH)
  const dw = srcW * scale
  const dh = srcH * scale
  const dx = (w - dw) / 2
  const dy = (h - dh) / 2
  if (typeof source.draw === 'function') {
    source.draw(ctx, dx, dy, dw, dh) // mediabunny VideoSample
  } else {
    ctx.drawImage(source, dx, dy, dw, dh)
  }
}

/** Paint background + overlay into `ctx` for one frame. A null overlay draws bare footage. */
export function compositeFrame(ctx, w, h, background, videoSample, overlayCanvas) {
  ctx.clearRect(0, 0, w, h)
  if (background?.kind === 'image') {
    drawCover(ctx, background.bitmap, background.width, background.height, w, h)
  } else if (videoSample) {
    drawCover(ctx, videoSample, background.width, background.height, w, h)
  } else {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, w, h)
  }
  if (overlayCanvas) ctx.drawImage(overlayCanvas, 0, 0)
}
