/**
 * Where the reference video's first frame sits on the GPX time axis,
 * in seconds from the GPX origin.
 *
 * When both `gpxStartTime` (ISO 8601) and `video.creationTime` (ISO 8601)
 * are present, the difference gives us real wall-clock alignment. The
 * `userOffsetSec` then compensates for camera clock drift or wrong-timezone
 * recordings.
 *
 * When either timestamp is missing, the offset alone places the video on
 * the axis — the UI treats this as "manual placement" mode.
 */
export function videoStartOnAxis(gpxStartTime, video) {
  if (!video) return 0
  const userOffset = video.userOffsetSec ?? 0
  const gpxMs = gpxStartTime ? Date.parse(gpxStartTime) : NaN
  const videoMs = video.creationTime ? Date.parse(video.creationTime) : NaN
  if (!isNaN(gpxMs) && !isNaN(videoMs)) {
    return (videoMs - gpxMs) / 1000 + userOffset
  }
  return userOffset
}

/**
 * Compute the userOffsetSec that puts the video's first frame at
 * `targetSec` on the GPX time axis. Inverse of videoStartOnAxis.
 */
export function offsetForVideoStart(gpxStartTime, video, targetSec) {
  if (!video) return 0
  const gpxMs = gpxStartTime ? Date.parse(gpxStartTime) : NaN
  const videoMs = video.creationTime ? Date.parse(video.creationTime) : NaN
  if (!isNaN(gpxMs) && !isNaN(videoMs)) {
    return Math.round(targetSec - (videoMs - gpxMs) / 1000)
  }
  return Math.round(targetSec)
}

/**
 * True when wall-clock alignment (userOffsetSec = 0) is meaningful AND
 * the resulting video extent overlaps the GPX activity. Decides whether
 * the "Move video to recording time" affordance should be offered.
 */
export function wallClockApplicable(gpxStartTime, video, activityDuration) {
  if (!video?.creationTime || !gpxStartTime) return false
  const gpxMs = Date.parse(gpxStartTime)
  const videoMs = Date.parse(video.creationTime)
  if (isNaN(gpxMs) || isNaN(videoMs)) return false
  const startAtZero = (videoMs - gpxMs) / 1000
  const endAtZero = startAtZero + (video.duration ?? 0)
  const dur = activityDuration ?? 0
  return endAtZero > 0 && startAtZero < dur
}
