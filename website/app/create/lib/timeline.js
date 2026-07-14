// How the overlay's animation sits inside the exported clip.
//
// The overlay has its own length (how fast the ride sweeps) and its own start
// offset (when it appears in the footage). The export always runs for the
// length of the background clip, so the two are independent: the overlay can
// finish early, and when it does its last frame stays on screen.

export const MIN_OVERLAY_SECONDS = 1
export const MAX_OVERLAY_SECONDS = 30

export function buildTimeline(session, clipSeconds, startSeconds) {
  const { fps, frameCount, width, height } = session
  const totalFrames = clipSeconds ? Math.max(1, Math.round(clipSeconds * fps)) : frameCount
  return {
    fps,
    width,
    height,
    overlayFrames: frameCount,
    startFrame: Math.round((startSeconds || 0) * fps),
    totalFrames,
    seconds: totalFrames / fps,
  }
}

/** Overlay frame to draw at output frame `i`, or -1 when the overlay is not up yet. */
export function overlayFrameAt(timeline, i) {
  if (i < timeline.startFrame) return -1
  return Math.min(i - timeline.startFrame, timeline.overlayFrames - 1)
}
