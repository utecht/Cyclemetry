<script>
  /**
   * Renders the reference video behind the overlay preview.
   *
   * Two modes — both driven by the existing RAF loop, which advances at
   * real-time (1×):
   *
   * - Scrub (paused): drive `video.currentTime` from `selectedSecond`,
   *   small epsilon (0.02s) so every scrub registers visually.
   * - Playback: let the video play natively at 1× via `play()`. RAF also
   *   ticks at 1×, so both clocks stay close; the same sync effect only
   *   corrects drift above 0.05s — wide enough to avoid yanking the video
   *   between natural frame updates, tight enough that scrubbing-while-
   *   playing snaps the video to the new position immediately.
   *
   * Hidden whenever the playhead falls outside the video's extent, so the
   * checkered background re-emerges and the user can tell "no video at
   * this timestamp."
   */
  import { getContext } from 'svelte'
  import { convertFileSrc } from '@tauri-apps/api/core'
  import { videoStartOnAxis as computeStartOnAxis } from '@/lib/videoAlignment.js'

  let { playing = false } = $props()

  const app = getContext('app')

  let videoEl = $state(null)

  let video = $derived(app.video)
  let src = $derived(
    video?.path && !video.missing ? convertFileSrc(video.path) : null,
  )
  let startOnAxis = $derived(computeStartOnAxis(app.gpxStartTime, video))
  let endOnAxis = $derived(startOnAxis + (video?.duration ?? 0))
  let inRange = $derived(
    !!video &&
      !video.missing &&
      (video.duration ?? 0) > 0 &&
      app.selectedSecond >= startOnAxis &&
      app.selectedSecond <= endOnAxis,
  )

  // Drift-correction sync. Wider epsilon during playback so the video's
  // natural frame cadence doesn't trigger a seek every RAF tick; tighter
  // when paused so scrubs land precisely.
  $effect(() => {
    if (!videoEl || !inRange || !video) return
    const target = app.selectedSecond - startOnAxis
    const clamped = Math.max(0, Math.min(target, video.duration))
    const epsilon = playing ? 0.05 : 0.02
    if (Math.abs(videoEl.currentTime - clamped) > epsilon) {
      videoEl.currentTime = clamped
    }
  })

  // Play / pause the video element to match the timeline's playback state.
  // Out-of-range playback pauses the video (the checkered area is showing,
  // so playing under it is wasted decode); when the playhead re-enters
  // range, this effect re-fires and resumes play.
  $effect(() => {
    if (!videoEl) return
    if (playing && inRange) {
      // play() may reject on hostile autoplay policies; the user gesture
      // that toggled `playing` should satisfy WebKit, so swallow rather
      // than surface noise the user can't act on.
      videoEl.play().catch(() => {})
    } else {
      videoEl.pause()
    }
  })
</script>

{#if src}
  <video
    bind:this={videoEl}
    {src}
    muted
    playsinline
    preload="auto"
    class="absolute inset-0 w-full h-full object-cover pointer-events-none rounded-lg"
    style:visibility={inRange ? 'visible' : 'hidden'}
  ></video>
{/if}
