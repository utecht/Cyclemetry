// Client-side mp4 export: overlay frames from wasm, background frames from the
// uploaded clip, composited on a canvas and encoded with WebCodecs (muxed by
// mediabunny). Audio from the clip is copied across untouched when the mp4
// container accepts its codec, and re-encoded when it doesn't.

import { renderOverlayFrame } from './engine'
import { compositeFrame } from './background'
import { overlayFrameAt } from './timeline'

export class ExportCanceled extends Error {}

async function addAudioTrack(output, format, background, endTime) {
  const audioTrack = await background?.input?.getPrimaryAudioTrack?.()
  if (!audioTrack || !(await audioTrack.canDecode())) return null

  const mb = await import('mediabunny')
  if (format.getSupportedAudioCodecs().includes(audioTrack.codec)) {
    const source = new mb.EncodedAudioPacketSource(audioTrack.codec)
    output.addAudioTrack(source)
    return async () => {
      const sink = new mb.EncodedPacketSink(audioTrack)
      const meta = { decoderConfig: await audioTrack.getDecoderConfig() }
      let first = true
      for await (const packet of sink.packets()) {
        if (packet.timestamp >= endTime) break
        // AAC starts with negative-timestamp priming packets, which the source
        // container expresses as an edit list and the muxer refuses. Drop the
        // ones that are entirely before zero and trim the one that straddles it.
        const end = packet.timestamp + packet.duration
        if (end <= 0) continue
        const trimmed =
          packet.timestamp < 0 ? packet.clone({ timestamp: 0, duration: end }) : packet
        await source.add(trimmed, first ? meta : undefined)
        first = false
      }
      source.close()
    }
  }

  const codec = await mb.getFirstEncodableAudioCodec(format.getSupportedAudioCodecs())
  if (!codec) return null
  const source = new mb.AudioSampleSource({ codec, bitrate: mb.QUALITY_HIGH })
  output.addAudioTrack(source)
  return async () => {
    const sink = new mb.AudioSampleSink(audioTrack)
    for await (const sample of sink.samples(0, endTime)) {
      await source.add(sample)
      sample.close()
    }
    source.close()
  }
}

/**
 * Render the whole clip and return it as an mp4 Blob. `onProgress` is called
 * with 0…1; `shouldCancel` is polled once per frame.
 */
export async function exportMp4({
  mod,
  timeline,
  background,
  onProgress = () => {},
  shouldCancel = () => false,
}) {
  const { width, height, fps, totalFrames } = timeline
  const mb = await import('mediabunny')

  const codec = await mb.getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], {
    width,
    height,
  })
  if (!codec) throw new Error('this browser has no video encoder available')

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  const overlayCanvas = new OffscreenCanvas(width, height)
  const overlayCtx = overlayCanvas.getContext('2d')
  const overlayPixels = new ImageData(width, height)

  const format = new mb.Mp4OutputFormat()
  const output = new mb.Output({ format, target: new mb.BufferTarget() })
  const videoSource = new mb.CanvasSource(canvas, {
    codec,
    bitrate: mb.QUALITY_HIGH,
  })
  output.addVideoTrack(videoSource, { frameRate: fps })

  const endTime = totalFrames / fps
  const pumpAudio = await addAudioTrack(output, format, background, endTime)

  const cancel = async () => {
    await output.cancel()
    throw new ExportCanceled('export canceled')
  }

  await output.start()
  if (pumpAudio) await pumpAudio()

  // Walk the background clip in decode order alongside the overlay's frame
  // grid: hold each decoded sample until the next one's timestamp is due. The
  // clip's frame rate never has to match the overlay's.
  const samples = background?.kind === 'video' ? background.sink.samples(0, endTime) : null
  let current = null
  let upcoming = samples ? (await samples.next()).value : null

  let lastOverlay = -1
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (shouldCancel()) await cancel()
      const timestamp = i / fps

      while (upcoming && upcoming.timestamp <= timestamp + 1e-6) {
        current?.close()
        current = upcoming
        upcoming = (await samples.next()).value ?? null
      }

      // -1 until the overlay's start offset; clamped to the last frame after it
      // finishes, so a short overlay holds as a still over the rest of the clip
      // (and we skip re-rendering that held frame).
      const overlayIdx = overlayFrameAt(timeline, i)
      if (overlayIdx >= 0 && overlayIdx !== lastOverlay) {
        renderOverlayFrame(mod, overlayIdx, overlayPixels)
        overlayCtx.putImageData(overlayPixels, 0, 0)
      }
      lastOverlay = overlayIdx
      compositeFrame(
        ctx,
        width,
        height,
        background,
        current,
        overlayIdx >= 0 ? overlayCanvas : null,
      )

      await videoSource.add(timestamp, 1 / fps)
      onProgress((i + 1) / totalFrames)
    }
  } finally {
    current?.close()
    upcoming?.close()
  }

  videoSource.close()
  await output.finalize()
  return new Blob([output.target.buffer], { type: 'video/mp4' })
}
