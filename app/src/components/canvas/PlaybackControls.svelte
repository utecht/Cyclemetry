<script>
  import { formatTime } from '@/lib/utils.js'
  import { Play, Pause, SkipBack, SkipForward } from 'lucide-svelte'
  import Tooltip from '@/components/ui/Tooltip.svelte'

  let {
    playhead = $bindable(0),
    start = 0,                  // overlay window start (sceneStart)
    end = 1,                    // overlay window end (sceneEnd)
    playing = $bindable(false),
    previewFps = $bindable(5),
    buffered = [],   // array of seconds that are ready in cache
    onseek,
    distanceInfo = null,     // { total_m, overlay_start_m, overlay_end_m }
    customDistanceM = null,  // current custom reference point in metres
    oncustomdistancechange,
    markerDistanceM = null,  // selected course marker position in metres
    markerStyle = 'checkered',
    markerColor = '#ef4444',
    onmarkerdistancechange,
  } = $props()

  // Scrubbing is bounded to the overlay render window — the bar's left
  // edge IS sceneStart, right edge IS sceneEnd. Visualizing the overlay's
  // position within the broader activity happens on the LeftSidebar mini
  // GPX track and the VideoAlignmentBar.
  function seek(s) {
    playhead = Math.max(start, Math.min(s, end))
    onseek?.(playhead)
  }

  function stepBack() { seek(Math.max(start, Math.floor(playhead) - 1)) }
  function stepForward() { seek(Math.min(end, Math.floor(playhead) + 1)) }

  function onScrub(e) {
    seek(parseFloat(e.target.value))
  }

  function onDistanceScrub(e) {
    oncustomdistancechange?.(parseFloat(e.target.value))
  }

  function onMarkerScrub(e) {
    onmarkerdistancechange?.(parseFloat(e.target.value))
  }

  let duration = $derived(end - start)

  // ── Visual smoothing for the scrub thumb ────────────────────────────────
  // During playback the upstream `playhead` updates in coarse hops:
  // ~4 Hz when the video is master (HTML5 `timeupdate` is sparse), and
  // ~60 Hz otherwise. The frame cache + prefetch want truth-driven
  // `playhead`, but the slider thumb feels jumpy without between-update
  // interpolation. `smoothPlayhead` advances at vsync, clamped to a small
  // window around truth so it never runs ahead during a stall or lags
  // behind during a scrub.
  let smoothPlayhead = $state(playhead)
  $effect(() => {
    if (!playing) {
      smoothPlayhead = playhead
      return
    }
    let lastTick = performance.now()
    let raf = requestAnimationFrame(function step(now) {
      const dt = (now - lastTick) / 1000
      lastTick = now
      let next = smoothPlayhead + dt
      // Snap to truth on big jumps (user scrubbed mid-play).
      if (Math.abs(playhead - next) > 1.0) next = playhead
      // Cap how far ahead/behind of truth the display can wander, so a
      // video stall or burst doesn't desync the visual from the audio.
      next = Math.min(next, playhead + 0.3)
      next = Math.max(next, playhead - 0.5)
      // Don't visually overshoot the end of the overlay window.
      if (next > end) next = end
      smoothPlayhead = next
      raf = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(raf)
  })

  let pct = $derived(
    duration > 0 ? ((smoothPlayhead - start) / duration) * 100 : 0,
  )

  // Distance bar derived values. The bar spans the overlay window's
  // distance range — overlay_start_m on the left, overlay_end_m on the
  // right. Visualizing the broader activity context isn't useful here; we
  // only set reference points that the value element renders inside the
  // overlay.
  let distOverlayStart = $derived(distanceInfo?.overlay_start_m ?? 0)
  let distOverlayEnd = $derived(distanceInfo?.overlay_end_m ?? 1)
  let distOverlayRange = $derived(
    Math.max(0.0001, distOverlayEnd - distOverlayStart),
  )
  let distDotPct = $derived(
    distanceInfo && customDistanceM !== null
      ? Math.max(
          0,
          Math.min(
            100,
            ((customDistanceM - distOverlayStart) / distOverlayRange) * 100,
          ),
        )
      : 0,
  )
  let markerDotPct = $derived(
    distanceInfo && markerDistanceM !== null
      ? Math.max(
          0,
          Math.min(
            100,
            ((markerDistanceM - distOverlayStart) / distOverlayRange) * 100,
          ),
        )
      : 0,
  )
  let markerShapeClass = $derived(
    markerStyle === 'circle'
      ? 'marker-range marker-circle'
      : markerStyle === 'rectangle'
        ? 'marker-range marker-rectangle'
        : 'marker-range marker-checkered'
  )
  let markerCss = $derived(`--marker-pct: ${markerDotPct}%; --marker-color: ${markerColor || '#ef4444'}`)
</script>

<div class="flex flex-col gap-2 px-4 py-3 border-t border-zinc-800">
  <!-- Scrub bar with buffered indicator -->
  <div class="relative h-5 flex items-center">
    <!-- Buffered ranges (visual only) -->
    <div class="absolute inset-x-0 h-1 rounded-full bg-zinc-800 overflow-hidden">
      {#each buffered as s (s)}
        <div
          class="absolute h-full bg-zinc-600/50 w-[2px]"
          style={`left: ${duration > 0 ? ((s - start) / duration) * 100 : 0}%`}
        ></div>
      {/each}
    </div>
    <!-- Range input. `value` is bound to the smoothed display playhead so
         the thumb moves at vsync rather than in 250 ms timeupdate hops.
         `step` is sub-second so the thumb can sit anywhere on the bar —
         step=1 would re-quantize it back to integer-second hops, defeating
         the smoothing. The timecode display still rounds to whole seconds
         via secToTimecode/formatTime, so display granularity is unaffected.
         Scrubs still write through to `playhead` via onScrub. -->
    <input
      type="range"
      min={start}
      max={end}
      step={0.01}
      value={smoothPlayhead}
      oninput={onScrub}
      style="--pct: {pct}%"
      class="scrub-range absolute inset-x-0 h-full w-full appearance-none bg-transparent"
    />
  </div>

  <!-- Distance reference bar — visible only when a distance element with reference='custom' is selected.
       Bar spans the overlay window's distance range; the whole bar IS the overlay. -->
  {#if distanceInfo && customDistanceM !== null}
    <div class="relative h-5 flex items-center">
      <div class="relative w-full h-full flex items-center">
        <div class="absolute inset-x-0 h-1 rounded-full bg-zinc-800"></div>
        <input
          type="range"
          min={distOverlayStart}
          max={distOverlayEnd}
          step={10}
          value={customDistanceM}
          oninput={onDistanceScrub}
          style="--dist-pct: {distDotPct}%"
          class="dist-range absolute inset-x-0 h-full w-full appearance-none bg-transparent"
          title="Custom distance reference: {customDistanceM >= 1000 ? (customDistanceM / 1000).toFixed(1) + ' km' : Math.round(customDistanceM) + ' m'}"
        />
      </div>
    </div>
  {/if}

  <!-- Course marker bar — visible when editing a selected map marker.
       Same axis as the distance bar. -->
  {#if distanceInfo && markerDistanceM !== null}
    <div class="relative h-5 flex items-center">
      <div class="relative w-full h-full flex items-center">
        <div class="absolute inset-x-0 h-1 rounded-full bg-zinc-800"></div>
        <input
          type="range"
          min={distOverlayStart}
          max={distOverlayEnd}
          step={10}
          value={markerDistanceM}
          oninput={onMarkerScrub}
          style={markerCss}
          class="{markerShapeClass} absolute inset-x-0 h-full w-full appearance-none bg-transparent"
          title="Course marker: {markerDistanceM >= 1000 ? (markerDistanceM / 1000).toFixed(1) + ' km' : Math.round(markerDistanceM) + ' m'}"
        />
      </div>
    </div>
  {/if}

  <!-- Controls row -->
  <div class="relative flex items-center justify-center">
    <div class="flex items-center gap-2">
      <Tooltip content="−1 second" side="top">
        <button
          onclick={stepBack}
          class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Step back 1 second"
        >
          <SkipBack size={14} />
        </button>
      </Tooltip>

      <button
        onclick={() => playing = !playing}
        class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary/85 active:scale-95"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {#if playing}
          <Pause size={14} fill="currentColor" strokeWidth={0} />
        {:else}
          <Play size={14} fill="currentColor" strokeWidth={0} class="translate-x-[1px]" />
        {/if}
      </button>

      <Tooltip content="+1 second" side="top">
        <button
          onclick={stepForward}
          class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Step forward 1 second"
        >
          <SkipForward size={14} />
        </button>
      </Tooltip>
    </div>

    <span class="absolute right-0 font-mono text-[11px] text-zinc-500 tabular-nums">
      {formatTime(playhead - start)} / {formatTime(duration)}
    </span>
  </div>
</div>

<style>
  /* Default cursor for the full input hit area; the visible track + thumb
     pseudo-elements override to pointer below, so the cursor only changes
     when the user is over the actual draggable surface. */
  .scrub-range {
    cursor: default;
  }
  .scrub-range::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--primary);
    cursor: pointer;
    position: relative;
    z-index: 1;
    margin-top: -4px;
  }
  .scrub-range::-webkit-slider-runnable-track {
    height: 4px;
    cursor: pointer;
    background: linear-gradient(
      to right,
      var(--primary) calc(var(--pct, 0%)),
      #3f3f46 calc(var(--pct, 0%))
    );
    border-radius: 9999px;
  }

  .dist-range,
  .marker-range {
    cursor: default;
  }
  .dist-range::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #F59E0B;
    cursor: pointer;
    position: relative;
    z-index: 1;
    margin-top: -4px;
  }
  .dist-range::-webkit-slider-runnable-track {
    height: 4px;
    cursor: pointer;
    background: transparent;
    border-radius: 9999px;
  }

  .marker-range::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid #18181b;
    background: var(--marker-color, #ef4444);
    cursor: pointer;
    position: relative;
    z-index: 1;
    margin-top: -5px;
  }
  .marker-checkered::-webkit-slider-thumb {
    width: 16px;
    height: 12px;
    border-radius: 2px;
    background-color: #fff;
    background-image:
      linear-gradient(45deg, #111 25%, transparent 25%),
      linear-gradient(-45deg, #111 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #111 75%),
      linear-gradient(-45deg, transparent 75%, #111 75%);
    background-size: 8px 8px;
    background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  }
  .marker-rectangle::-webkit-slider-thumb {
    width: 16px;
    height: 12px;
    border-radius: 2px;
  }
  .marker-range::-webkit-slider-runnable-track {
    height: 4px;
    cursor: pointer;
    background: transparent;
    border-radius: 9999px;
  }
</style>
