/**
 * Wall-clock difference between the video's first frame and the GPX origin,
 * in seconds (positive = video starts after the GPX). Null when either
 * timestamp is missing or unparseable — callers use null to distinguish
 * "manual placement only" from a real wall-clock relationship.
 */
export function wallClockDeltaSec(gpxStartTime, video) {
  const gpxMs = gpxStartTime ? Date.parse(gpxStartTime) : NaN
  const videoMs = video?.creationTime ? Date.parse(video.creationTime) : NaN
  if (isNaN(gpxMs) || isNaN(videoMs)) return null
  return (videoMs - gpxMs) / 1000
}

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
  const delta = wallClockDeltaSec(gpxStartTime, video)
  return delta != null ? delta + userOffset : userOffset
}

/**
 * Compute the userOffsetSec that puts the video's first frame at
 * `targetSec` on the GPX time axis. Inverse of videoStartOnAxis.
 */
export function offsetForVideoStart(gpxStartTime, video, targetSec) {
  if (!video) return 0
  const delta = wallClockDeltaSec(gpxStartTime, video)
  return Math.round(delta != null ? targetSec - delta : targetSec)
}

/**
 * True when wall-clock alignment (userOffsetSec = 0) is meaningful AND
 * the resulting video extent overlaps the GPX activity. Decides whether
 * wall-clock placement should be trusted automatically.
 */
export function wallClockApplicable(gpxStartTime, video, activityDuration) {
  const startAtZero = wallClockDeltaSec(gpxStartTime, video)
  if (startAtZero == null) return false
  const endAtZero = startAtZero + (video.duration ?? 0)
  const dur = activityDuration ?? 0
  return endAtZero > 0 && startAtZero < dur
}
