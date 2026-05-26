<script>
  /**
   * Shows the reference video's extent on the same time axis as the
   * playback scrubber, with the video band draggable to nudge the
   * userOffset. Only mounted when `app.selectedVideo` is true, mirroring
   * the conditional distance-reference bar pattern.
   *
   * The band is positioned by the shared `videoStartOnAxis()` helper
   * (Phase 3) — when both timestamps are present this is real wall-clock
   * alignment; otherwise the offset alone places it.
   */
  import { getContext } from 'svelte'
  import { AlertTriangle } from 'lucide-svelte'
  import {
    videoStartOnAxis as computeStartOnAxis,
    offsetForVideoStart,
  } from '@/lib/videoAlignment.js'

  const app = getContext('app')

  let trackEl = $state(null)
  let drag = $state(null)

  let video = $derived(app.video)
  let videoDuration = $derived(video?.duration ?? 0)
  let videoUserOffset = $derived(video?.userOffsetSec ?? 0)

  // The bar's x-axis mirrors the playback scrub bar: left = sceneStart,
  // right = sceneEnd. As the overlay window shrinks the visible portion
  // of the video band grows proportionally.
  let sceneStart = $derived(app.config?.scene?.start ?? 0)
  let sceneEnd = $derived(app.config?.scene?.end ?? app.timelineDuration ?? 0)
  let overlayDuration = $derived(Math.max(0.0001, sceneEnd - sceneStart))

  // Video extent in absolute GPX seconds, then converted to overlay-axis
  // coordinates by subtracting sceneStart.
  let videoStartAbs = $derived(computeStartOnAxis(app.gpxStartTime, video))
  let videoEndAbs = $derived(videoStartAbs + videoDuration)
  let videoStartRel = $derived(videoStartAbs - sceneStart)
  let videoEndRel = $derived(videoEndAbs - sceneStart)

  let leftPct = $derived(
    Math.max(0, (videoStartRel / overlayDuration) * 100),
  )
  let rightPct = $derived(
    Math.min(100, (videoEndRel / overlayDuration) * 100),
  )
  let widthPct = $derived(Math.max(0, rightPct - leftPct))
  let overflowLeft = $derived(videoStartRel < 0)
  let overflowRight = $derived(videoEndRel > overlayDuration)

  let hasOverlap = $derived(
    Math.min(overlayDuration, videoEndRel) > Math.max(0, videoStartRel) &&
      videoDuration > 0,
  )

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v))
  }

  function beginDrag(e) {
    if (!trackEl) return
    e.preventDefault()
    trackEl.setPointerCapture(e.pointerId)
    app.beginEditBatch?.()
    drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      initial: videoUserOffset,
    }
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return
    const w = trackEl?.offsetWidth ?? 1
    // The bar's pixel width represents `overlayDuration` seconds — convert
    // drag deltas in that scale, so a 10% drag shifts the offset by 10%
    // of the overlay window.
    const dxSec = ((e.clientX - drag.startX) / w) * overlayDuration
    const proposed = drag.initial + dxSec
    // Compute the resulting band-axis position with the proposed offset,
    // then bound its CENTER to the visible timeline window so the band
    // always stays grabbable. The previous clamp bounded userOffsetSec to
    // [-videoDuration, timelineDuration], which silently destroyed any
    // wall-clock-derived offset (often hours-of-seconds) and "reset" the
    // band to 0 the moment the drag started.
    const proposedAxis = computeStartOnAxis(app.gpxStartTime, {
      ...video,
      userOffsetSec: proposed,
    })
    const minAxis = sceneStart - videoDuration / 2
    const maxAxis = sceneEnd - videoDuration / 2
    const clampedAxis = clamp(proposedAxis, minAxis, maxAxis)
    app.setVideoOffset(
      offsetForVideoStart(app.gpxStartTime, video, clampedAxis),
    )
  }

  function endDrag(e) {
    if (!drag) return
    if (trackEl?.hasPointerCapture(e.pointerId)) {
      trackEl.releasePointerCapture(e.pointerId)
    }
    app.endEditBatch?.()
    drag = null
  }

  function moveVideoToTimelineStart() {
    app.setVideoOffset(offsetForVideoStart(app.gpxStartTime, video, sceneStart))
  }
</script>

{#if video && !video.missing && videoDuration > 0}
  <div class="px-4 pt-2 pb-1 space-y-1.5">
    <div class="flex items-center justify-between text-[10px]">
      <span class="font-semibold uppercase tracking-wider text-sky-400/80"
        >Video alignment</span
      >
      {#if !hasOverlap}
        <span class="flex items-center gap-1.5 text-amber-400">
          <AlertTriangle size={10} />
          No overlap —
          <button
            type="button"
            onclick={moveVideoToTimelineStart}
            class="underline decoration-dotted underline-offset-2
                   hover:text-amber-200 transition-colors"
            >move to timeline start</button
          >
        </span>
      {/if}
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={trackEl}
      class="relative h-5 select-none"
      onpointermove={onPointerMove}
      onpointerup={endDrag}
      onpointercancel={endDrag}
    >
      <div class="absolute inset-x-0 top-2 h-1 rounded-full bg-zinc-900"></div>
      {#if widthPct > 0}
        <button
          type="button"
          aria-label="Video extent — drag to nudge offset"
          title="Drag to nudge the video offset"
          onpointerdown={beginDrag}
          class="absolute top-1 h-3 rounded-[2px] bg-sky-500/60
                 border border-sky-400/80 cursor-grab
                 hover:bg-sky-500/80 transition-colors
                 {drag ? 'cursor-grabbing' : ''}"
          style="left: {leftPct}%; width: {widthPct}%"
        ></button>
        {#if overflowLeft}
          <span
            class="absolute top-1 left-0 text-sky-400 text-[10px] leading-none"
            title="Video starts before activity">‹</span
          >
        {/if}
        {#if overflowRight}
          <span
            class="absolute top-1 right-0 text-sky-400 text-[10px] leading-none"
            title="Video ends after activity">›</span
          >
        {/if}
      {/if}
    </div>
  </div>
{/if}
