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
