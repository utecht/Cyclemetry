<script>
  /**
   * Two-track timeline for aligning overlay bounds against video footage.
   *
   * Top track: full GPX duration with draggable overlay-start / overlay-end
   * handles defining the render window.
   *
   * Bottom track: where the loaded video sits on the same time axis,
   * positioned by `gpxStartTime` ↔ `video.creationTime` (with `userOffsetSec`
   * compensating for camera clock drift / wrong timezone). Drag the video
   * band to nudge the offset visually; the offset field accepts ±HH:MM:SS
   * for precise input.
   *
   * Only mounted when a video is loaded — without one, the LeftSidebar
   * Timeline fields are the simpler way to set start/end.
   */
  import { getContext } from 'svelte'
  import { AlertTriangle } from 'lucide-svelte'
  import { videoStartOnAxis as computeStartOnAxis } from '@/lib/videoAlignment.js'

  const app = getContext('app')

  let trackEl = $state(null)
  let drag = $state(null)

  // ── Time math ────────────────────────────────────────────────────────────
  let gpxDuration = $derived(Math.max(0.0001, app.timelineDuration ?? 0))
  let overlayStart = $derived(app.config?.scene?.start ?? 0)
  let overlayEnd = $derived(app.config?.scene?.end ?? gpxDuration)

  let gpxStartMs = $derived(
    app.gpxStartTime ? Date.parse(app.gpxStartTime) : null,
  )
  let videoCreationMs = $derived(
    app.video?.creationTime ? Date.parse(app.video.creationTime) : null,
  )
  let videoUserOffsetSec = $derived(app.video?.userOffsetSec ?? 0)
  let videoDuration = $derived(app.video?.duration ?? 0)

  // Where the video band's left edge sits on the GPX axis, in seconds from
  // the GPX origin. When both timestamps are present we have a real alignment
  // anchor; otherwise the user offset alone places the band.
  let videoStartOnAxis = $derived(
    computeStartOnAxis(app.gpxStartTime, app.video),
  )
  let videoEndOnAxis = $derived(videoStartOnAxis + videoDuration)

  // Visual clipping for the band so it never escapes the track horizontally.
  let videoLeftPct = $derived(
    Math.max(0, (videoStartOnAxis / gpxDuration) * 100),
  )
  let videoRightPct = $derived(
    Math.min(100, (videoEndOnAxis / gpxDuration) * 100),
  )
  let videoBandWidthPct = $derived(Math.max(0, videoRightPct - videoLeftPct))
  let overflowLeft = $derived(videoStartOnAxis < 0)
  let overflowRight = $derived(videoEndOnAxis > gpxDuration)

  // GPX/video overlap window — zero means we should warn the user.
  let overlapStart = $derived(Math.max(0, videoStartOnAxis))
  let overlapEnd = $derived(Math.min(gpxDuration, videoEndOnAxis))
  let hasOverlap = $derived(overlapEnd > overlapStart && videoDuration > 0)

  // Without both anchors we can't claim "real" alignment — the offset just
  // becomes a manual placement control. UI changes the labels accordingly.
  let hasRealAlignment = $derived(gpxStartMs != null && videoCreationMs != null)

  let overlayStartPct = $derived((overlayStart / gpxDuration) * 100)
  let overlayEndPct = $derived((overlayEnd / gpxDuration) * 100)

  // ── Drag handling ────────────────────────────────────────────────────────
  function pxToSec(deltaPx) {
    const w = trackEl?.offsetWidth ?? 1
    return (deltaPx / w) * gpxDuration
  }

  function beginDrag(handle, e) {
    if (!trackEl) return
    e.preventDefault()
    trackEl.setPointerCapture(e.pointerId)
    app.beginEditBatch?.()
    const initial =
      handle === 'start'
        ? overlayStart
        : handle === 'end'
          ? overlayEnd
          : videoUserOffsetSec
    drag = { handle, pointerId: e.pointerId, startX: e.clientX, initial }
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v))
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return
    const delta = pxToSec(e.clientX - drag.startX)
    const next = drag.initial + delta
    if (drag.handle === 'start') {
      app.updateScene({ start: clamp(next, 0, overlayEnd - 0.1) })
    } else if (drag.handle === 'end') {
      app.updateScene({ end: clamp(next, overlayStart + 0.1, gpxDuration) })
    } else if (drag.handle === 'video') {
      app.setVideoOffset(next)
    }
  }

  function endDrag(e) {
    if (!drag) return
    if (trackEl?.hasPointerCapture(e.pointerId)) {
      trackEl.releasePointerCapture(e.pointerId)
    }
    app.endEditBatch?.()
    drag = null
  }

  // ── Offset HH:MM:SS field ────────────────────────────────────────────────
  function fmtOffset(sec) {
    const sign = sec < 0 ? '-' : '+'
    const abs = Math.abs(Math.round(sec))
    const h = Math.floor(abs / 3600)
    const m = Math.floor((abs % 3600) / 60)
    const s = abs % 60
    return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  function parseOffset(raw) {
    let str = raw.trim()
    if (!str) return 0
    let sign = 1
    if (str.startsWith('-')) {
      sign = -1
      str = str.slice(1)
    } else if (str.startsWith('+')) {
      str = str.slice(1)
    }
    if (/^\d+:\d{1,2}:\d{1,2}$/.test(str)) {
      const [h, m, s] = str.split(':').map(Number)
      return sign * (h * 3600 + m * 60 + s)
    }
    if (/^\d+:\d{1,2}$/.test(str)) {
      const [m, s] = str.split(':').map(Number)
      return sign * (m * 60 + s)
    }
    const n = Number(str)
    return isNaN(n) ? null : sign * n
  }

  function onOffsetChange(e) {
    const parsed = parseOffset(e.target.value)
    if (parsed == null) {
      e.target.value = fmtOffset(videoUserOffsetSec)
      return
    }
    app.setVideoOffset(parsed)
  }

  function bumpOffset(deltaSec) {
    app.setVideoOffset(videoUserOffsetSec + deltaSec)
  }
</script>

<div class="px-4 py-2 border-t border-zinc-800 space-y-2">
  <div class="flex items-center justify-between">
    <span
      class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
      >Alignment</span
    >
    {#if !hasOverlap}
      <span class="flex items-center gap-1 text-[10px] text-amber-400">
        <AlertTriangle size={10} />
        Video doesn't overlap activity — adjust offset
      </span>
    {/if}
  </div>

  <!-- Two-track timeline -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={trackEl}
    class="relative h-12 select-none"
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onpointercancel={endDrag}
  >
    <!-- GPX track (top half) -->
    <div class="absolute inset-x-0 top-0 h-5">
      <div
        class="absolute inset-x-0 top-2 h-1 rounded-full bg-zinc-800"
      ></div>
      <!-- Overlay window highlight -->
      <div
        class="absolute top-2 h-1 bg-primary/70 rounded-full"
        style="left: {overlayStartPct}%; width: {overlayEndPct -
          overlayStartPct}%"
      ></div>
      <!-- Start handle -->
      <button
        type="button"
        aria-label="Overlay start"
        onpointerdown={(e) => beginDrag('start', e)}
        class="absolute top-0 -translate-x-1/2 h-5 w-3 rounded-sm
               bg-primary border border-zinc-950 cursor-ew-resize
               hover:scale-110 transition-transform"
        style="left: {overlayStartPct}%"
      ></button>
      <!-- End handle -->
      <button
        type="button"
        aria-label="Overlay end"
        onpointerdown={(e) => beginDrag('end', e)}
        class="absolute top-0 -translate-x-1/2 h-5 w-3 rounded-sm
               bg-primary border border-zinc-950 cursor-ew-resize
               hover:scale-110 transition-transform"
        style="left: {overlayEndPct}%"
      ></button>
    </div>

    <!-- Video track (bottom half) -->
    <div class="absolute inset-x-0 bottom-0 h-5">
      <div
        class="absolute inset-x-0 top-2 h-1 rounded-full bg-zinc-900"
      ></div>
      {#if videoDuration > 0 && videoBandWidthPct > 0}
        <button
          type="button"
          aria-label="Video extent"
          title="Drag to nudge the video offset"
          onpointerdown={(e) => beginDrag('video', e)}
          class="absolute top-1 h-3 rounded-[2px] bg-sky-500/60
                 border border-sky-400/80 cursor-grab
                 hover:bg-sky-500/80 transition-colors
                 {drag?.handle === 'video' ? 'cursor-grabbing' : ''}"
          style="left: {videoLeftPct}%; width: {videoBandWidthPct}%"
        ></button>
        {#if overflowLeft}
          <span
            class="absolute top-1.5 left-0 text-sky-400 text-[10px] leading-none"
            title="Video starts before GPX">‹</span
          >
        {/if}
        {#if overflowRight}
          <span
            class="absolute top-1.5 right-0 text-sky-400 text-[10px] leading-none"
            title="Video ends after GPX">›</span
          >
        {/if}
      {:else if videoDuration > 0}
        <div
          class="absolute top-1 inset-x-0 h-3 flex items-center justify-center"
        >
          <span class="text-[10px] text-amber-400"
            >Video sits entirely outside the activity window</span
          >
        </div>
      {/if}
    </div>
  </div>

  <!-- Offset control + hints -->
  <div class="flex items-center gap-2 text-[11px] text-zinc-500">
    <span class="shrink-0">Offset</span>
    <button
      type="button"
      onclick={() => bumpOffset(-3600)}
      title="−1 hour"
      class="h-6 w-6 rounded border border-zinc-700 text-zinc-400
             hover:border-zinc-500 hover:text-zinc-200 transition-colors
             font-mono">−h</button
    >
    <input
      type="text"
      value={fmtOffset(videoUserOffsetSec)}
      onchange={onOffsetChange}
      placeholder="+00:00:00"
      class="h-6 w-24 rounded-[6px] border border-zinc-700 bg-zinc-800/60
             px-2 text-xs text-foreground focus:outline-none focus:ring-1
             focus:ring-ring font-mono tabular-nums text-center"
    />
    <button
      type="button"
      onclick={() => bumpOffset(3600)}
      title="+1 hour"
      class="h-6 w-6 rounded border border-zinc-700 text-zinc-400
             hover:border-zinc-500 hover:text-zinc-200 transition-colors
             font-mono">+h</button
    >
    {#if !hasRealAlignment}
      <span class="text-[10px] text-zinc-600 leading-tight">
        {#if gpxStartMs == null}
          GPX has no timestamps —
        {:else}
          video has no recording timestamp —
        {/if}
        offset positions the video manually.
      </span>
    {/if}
  </div>
</div>
