<script>
  /**
   * Center panel: manages the frame buffer, canvas preview, WYSIWYG SVG overlay,
   * and playback controls. This is the heart of the new UI.
   */
  import { getContext, untrack } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import PreviewCanvas from '../canvas/PreviewCanvas.svelte'
  import WysiwygLayer from '../canvas/WysiwygLayer.svelte'
  import PlaybackControls from '../canvas/PlaybackControls.svelte'
  import * as backend from '@/api/backend.js'

  const app = getContext('app')

  // ── Frame buffer ─────────────────────────────────────────────────────────────
  // Cache keyed by frame index (integer at previewFps resolution).
  // frame index 0 = scene start, increases by 1 per (1/previewFps) seconds.
  let cache = new SvelteMap()
  let pending = new SvelteSet()
  let shownWarnings = new SvelteSet()

  let currentFrameData = $state(null)  // { image, elements }
  let fetchError = $state(null)
  let previewNotice = $state(null)
  let playing = $state(false)
  let rafHandle = null
  let lastTick = null
  let stallTimer = null
  let configDebounce = null
  let previewGeneration = 0

  const PREFETCH_AHEAD = 5
  const MAX_CACHE = 30
  const MAX_CONCURRENT = 3
  const PREVIEW_SLOW_MS = 8000
  const PREVIEW_HARD_TIMEOUT_MS = 45000

  let previewFps = $derived(app.previewFps ?? 1)

  // Convert absolute second → frame index relative to scene start
  function secToFrameIdx(sec, fps, start) {
    return Math.round((sec - start) * fps)
  }

  // Buffered positions as seconds (for the scrub bar indicators)
  let bufferedSeconds = $derived(
    [...cache.keys()].map(idx => sceneStart + idx / previewFps).sort((a, b) => a - b)
  )

  function clearBuffer() {
    previewGeneration += 1
    cache.clear()
    pending.clear()
    fetchError = null
    previewNotice = null
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
  }

  async function fetchFrame(frameIdx) {
    const config = app.config
    if (!config) return console.debug('[tpl-diag] fetchFrame bail: no config')
    const fps = app.previewFps ?? 1
    const start = config.scene?.start ?? 0
    const end = config.scene?.end ?? app.timelineDuration
    const maxFrameIdx = Math.round((end - start) * fps)
    if (frameIdx < 0 || frameIdx > maxFrameIdx)
      return console.debug('[tpl-diag] fetchFrame bail: frameIdx out of range', { frameIdx, maxFrameIdx, start, end })
    if (cache.has(frameIdx) || pending.has(frameIdx))
      return console.debug('[tpl-diag] fetchFrame bail: cache/pending has', frameIdx)
    if (pending.size >= MAX_CONCURRENT)
      return console.debug('[tpl-diag] fetchFrame bail: MAX_CONCURRENT', pending.size)
    console.debug('[tpl-diag] fetchFrame start', { frameIdx, fps, start, end })
    // Fall back to the bundled demo GPX when no file has been loaded yet.
    // Guard against stale "null"/"undefined" strings persisted by older builds.
    const raw = app.gpxFilename
    const gpx =
      raw && raw !== 'null' && raw !== 'undefined' ? raw : 'demo.gpxinit'

    pending.add(frameIdx)
    const generation = previewGeneration
    let slowTimer = null
    let hardTimer = null
    try {
      slowTimer = setTimeout(() => {
        if (generation !== previewGeneration || currentFrameData) return
        previewNotice = 'Preparing preview is taking a little longer than usual…'
      }, PREVIEW_SLOW_MS)
      const timeout = new Promise((_, reject) => {
        hardTimer = setTimeout(
          () => reject(new Error('Preview is taking too long to generate. Choose an activity and template again, or retry if this keeps happening.')),
          PREVIEW_HARD_TIMEOUT_MS,
        )
      })
      let data = await Promise.race([backend.nativeGenerateDemo(config, gpx, frameIdx, fps, app.outputWidth, app.outputHeight), timeout])
      if (generation !== previewGeneration) return
      if (data?.image) {
        console.debug('[tpl-diag] fetchFrame got image', { frameIdx, elements: data.elements?.length })
        fetchError = null
        previewNotice = null
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
        // Surface any backend warning (e.g. GPX not found, using demo) — once per message
        if (data.warning && !shownWarnings.has(data.warning)) {
          shownWarnings.add(data.warning)
          app.errorMessage = data.warning
        }
        cache.set(frameIdx, data)
        // Evict oldest frames beyond MAX_CACHE
        if (cache.size > MAX_CACHE) {
          const oldest = cache.keys().next().value
          cache.delete(oldest)
        }
        // Show this frame if it's current, or if we don't have the current frame yet
        const currentIdx = secToFrameIdx(app.selectedSecond, fps, start)
        if (frameIdx === currentIdx || (frameIdx < currentIdx && !cache.has(currentIdx))) {
          console.debug('[tpl-diag] currentFrameData <- frame', frameIdx)
          currentFrameData = data
        } else {
          console.debug('[tpl-diag] frame NOT shown (not current)', { frameIdx, currentIdx })
        }
      }
    } catch (e) {
      if (generation !== previewGeneration) return
      console.warn('Frame fetch failed for frame', frameIdx, e)
      const fps2 = app.previewFps ?? 1
      const start2 = app.config?.scene?.start ?? 0
      const currentIdx = secToFrameIdx(app.selectedSecond, fps2, start2)
      const isCurrent = frameIdx === currentIdx
      const wasNeeded = !currentFrameData
      if (isCurrent || wasNeeded) {
        fetchError = e?.message ?? String(e)
      }
    } finally {
      if (slowTimer) clearTimeout(slowTimer)
      if (hardTimer) clearTimeout(hardTimer)
      pending.delete(frameIdx)
    }
  }

  // Re-fetch when config, gpx, or previewFps changes — debounced so a burst of
  // edits (e.g. dragging the color-picker wheel, which fires an input event per
  // hovered color) coalesces into a single render once the user pauses. The old
  // frame stays visible during the debounce window, so there's no flicker.
  $effect(() => {
    const _config = app.config
    const _fps = app.previewFps ?? 1
    void app.gpxFilename // reactive dep: re-run when GPX changes
    void app.outputWidth // reactive dep: re-render preview on resolution change
    void app.outputHeight

    if (configDebounce) clearTimeout(configDebounce)
    configDebounce = setTimeout(() => {
      configDebounce = null
      clearBuffer()
      if (!_config) return
      const start = _config.scene?.start ?? 0
      const end = _config.scene?.end ?? app.timelineDuration
      // Don't attempt to fetch when the timeline range is invalid — the sidebar
      // already shows a validation error; no point spinning here too.
      if (end <= start) {
        currentFrameData = null
        return
      }
      const s = Math.max(start, app.selectedSecond)
      const frameIdx = secToFrameIdx(s, _fps, start)
      fetchFrame(frameIdx)
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => { stallTimer = null }, 5000)
    }, 160)

    return () => {
      if (configDebounce) { clearTimeout(configDebounce); configDebounce = null }
    }
  })

  // Prefetch around playhead. cache.get(frameIdx) is the only intended reactive dep —
  // it re-runs when that frame arrives. fetchFrame calls are untracked to avoid
  // reads of pending/cache inside fetchFrame triggering re-runs.
  $effect(() => {
    const fps = previewFps
    const start = sceneStart
    const frameIdx = secToFrameIdx(app.selectedSecond, fps, start)
    const frame = cache.get(frameIdx)
    if (frame) currentFrameData = frame
    untrack(() => { for (let i = 0; i < PREFETCH_AHEAD; i++) fetchFrame(frameIdx + i) })
  })

  // Keep app.currentPreviewImage in sync so saveTemplate can use the latest frame.
  $effect(() => {
    if (currentFrameData?.image) app.currentPreviewImage = currentFrameData.image
  })

  // ── Playback RAF loop ────────────────────────────────────────────────────────
  $effect(() => {
    if (playing) {
      lastTick = performance.now()
      rafHandle = requestAnimationFrame(tick)
    } else {
      if (rafHandle) cancelAnimationFrame(rafHandle)
    }
    return () => { if (rafHandle) cancelAnimationFrame(rafHandle) }
  })

  function tick(now) {
    if (!playing) return
    const dt = (now - lastTick) / 1000
    lastTick = now
    const next = Math.min(app.selectedSecond + dt, sceneEnd)
    app.selectedSecond = next
    if (next >= sceneEnd) { playing = false; return }
    rafHandle = requestAnimationFrame(tick)
  }

  function seek(s) {
    app.selectedSecond = s
  }

  let sceneStart = $derived(app.config?.scene?.start ?? 0)
  let sceneEnd = $derived(app.config?.scene?.end ?? app.timelineDuration)

  // ── Distance reference slider ─────────────────────────────────────────────────
  // Show an amber dot on a second bar when a distance element with reference='custom' is selected.
  let selectedDistanceEl = $derived.by(() => {
    const id = app.selectedElementId
    const config = app.config
    if (!id || !config?.elements) return null
    const el = config.elements.find((e) => e.id === id)
    return el && el.type === 'value' ? el : null
  })

  let selectedCourseMarker = $derived.by(() => {
    const id = app.selectedElementId
    const config = app.config
    if (!id || !config?.elements) return null
    const el = config.elements.find((e) => e.id === id)
    if (!el || el.type !== 'plot' || el.value !== 'course' || !el.markers?.length) return null
    return el.markers.find((m) => m.id === app.selectedCourseMarkerId) ?? el.markers[0]
  })

  let showDistanceBar = $derived(
    selectedDistanceEl?.value === 'distance' &&
    (selectedDistanceEl?.distance_reference === 'custom' ||
     selectedDistanceEl?.distance_reference === 'since_custom')
  )
  let showCourseMarkerBar = $derived(!!selectedCourseMarker)

  let customDistanceM = $derived.by(() => {
    if (!showDistanceBar || !selectedDistanceEl) return null
    const t = selectedDistanceEl.distance_target ?? 0
    const u = selectedDistanceEl.unit ?? 'km'
    if (u === 'm') return t
    if (u === 'mi') return t * 1609.34
    return t * 1000
  })
  let courseMarkerDistanceM = $derived(
    showCourseMarkerBar ? (selectedCourseMarker?.distance ?? 0) : null
  )

  let distanceInfo = $state(null)

  $effect(() => {
    if ((!showDistanceBar && !showCourseMarkerBar) || !app.config) {
      distanceInfo = null
      return
    }
    const raw = app.gpxFilename
    const gpx = raw && raw !== 'null' && raw !== 'undefined' ? raw : 'demo.gpxinit'
    const start = sceneStart
    const end = sceneEnd
    backend.getActivityDistanceInfo(gpx, start, end)
      .then(info => { distanceInfo = info })
      .catch(() => { distanceInfo = null })
  })

  function onCustomDistanceChange(newM) {
    const id = app.selectedElementId
    const el = app.config?.elements?.find((e) => e.id === id)
    if (!el || el.type !== 'value') return
    const unit = el.unit ?? 'km'
    let displayVal
    if (unit === 'm') displayVal = newM
    else if (unit === 'mi') displayVal = Math.round((newM / 1609.34) * 100) / 100
    else displayVal = Math.round((newM / 1000) * 100) / 100
    app.updateElement(id, { distance_target: displayVal })
  }

  function onCourseMarkerDistanceChange(newM) {
    const id = app.selectedElementId
    const el = app.config?.elements?.find((e) => e.id === id)
    const marker = selectedCourseMarker
    if (!el || el.type !== 'plot' || !marker) return
    app.updateElement(id, {
      markers: (el.markers ?? []).map((m) => (
        m === marker || (marker.id && m.id === marker.id) ? { ...m, distance: newM } : m
      )),
    })
  }
  // Preview canvas matches the chosen output resolution (the backend renders
  // the demo frame retargeted to these dims), so the aspect ratio is honored.
  let sceneW = $derived(app.outputWidth ?? 1920)
  let sceneH = $derived(app.outputHeight ?? 1080)
  let aspectRatio = $derived(sceneH / sceneW)
  let sceneInvalid = $derived(sceneEnd <= sceneStart)

  // Preview zoom/pan. Pinch or Ctrl+wheel zooms toward the cursor; two-finger
  // scroll pans while zoomed (trackpad-native, no conflict with the element-
  // drag pointer layer). transform-origin is 0 0 so the focal math is a clean
  // closed form. Safe for WYSIWYG editing — drag reads svg.getScreenCTM(),
  // which already accounts for ancestor transforms. Double-click resets.
  let zoom = $state(1)
  let panX = $state(0)
  let panY = $state(0)
  let stageEl = $state()

  // Keep the scaled content overlapping the viewport so it can't be lost.
  function clampPan() {
    if (zoom <= 1) {
      panX = 0
      panY = 0
      return
    }
    const w = stageEl?.offsetWidth ?? 0
    const h = stageEl?.offsetHeight ?? 0
    const maxX = (zoom - 1) * w
    const maxY = (zoom - 1) * h
    panX = Math.min(0, Math.max(-maxX, panX))
    panY = Math.min(0, Math.max(-maxY, panY))
  }

  function onCanvasWheel(e) {
    if (!stageEl) return
    if (e.ctrlKey) {
      // Pinch / Ctrl+wheel → zoom toward the cursor.
      e.preventDefault()
      const next = Math.min(6, Math.max(1, zoom * Math.exp(-e.deltaY * 0.01)))
      if (next === zoom) return
      const rect = stageEl.getBoundingClientRect()
      const ratio = 1 - next / zoom
      panX += (e.clientX - rect.left) * ratio
      panY += (e.clientY - rect.top) * ratio
      zoom = next
      clampPan()
    } else if (zoom > 1) {
      // Two-finger scroll → pan the zoomed view.
      e.preventDefault()
      panX -= e.deltaX
      panY -= e.deltaY
      clampPan()
    }
  }

  function resetZoom() {
    zoom = 1
    panX = 0
    panY = 0
  }

  // Clamp playhead when scene start/end changes.
  // Skip when the range is invalid — clamping to a negative sceneEnd would corrupt selectedSecond
  // and cause fetchFrame to silently bail out (frameIdx < 0 guard) even after the user fixes values.
  $effect(() => {
    const s = sceneStart
    const e = sceneEnd
    if (e <= s) return
    if (app.selectedSecond < s) app.selectedSecond = s
    else if (app.selectedSecond > e) app.selectedSecond = e
  })

  // Spacebar toggles playback (unless typing or focused on a button).
  function onKeydown(e) {
    if (e.code !== 'Space') return
    const t = e.target
    if (
      t?.tagName === 'INPUT' ||
      t?.tagName === 'TEXTAREA' ||
      t?.tagName === 'SELECT' ||
      t?.tagName === 'BUTTON' ||
      t?.isContentEditable
    )
      return
    if (!app.config || sceneInvalid) return
    e.preventDefault()
    if (!playing && app.selectedSecond >= sceneEnd) app.selectedSecond = sceneStart
    playing = !playing
  }
</script>

<svelte:window onkeydown={onKeydown} />

<main class="flex-1 flex flex-col overflow-hidden bg-[#09090b]">
  <!-- Zoom indicator — pinned above the canvas, visible regardless of pan position -->
  {#if app.config && zoom !== 1}
    <div class="shrink-0 flex items-center justify-end px-3 py-1 border-b border-zinc-800/60 bg-zinc-950/80">
      <button
        onclick={resetZoom}
        class="text-[10px] font-mono text-zinc-400 hover:text-primary transition-colors"
        title="Reset zoom (or double-click the canvas)"
      >
        {Math.round(zoom * 100)}% · reset
      </button>
    </div>
  {/if}

  <!-- Canvas area (flexible height) -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="flex-1 flex items-center justify-center p-6 overflow-hidden"
    onwheel={onCanvasWheel}
    ondblclick={resetZoom}
  >
    {#if app.config}
      <!-- Aspect-ratio wrapper — always shown when a template is loaded -->
      <div
        bind:this={stageEl}
        class="relative shadow-2xl"
        style={`width: min(100%, calc((100vh - 180px) / ${aspectRatio})); aspect-ratio: ${sceneW} / ${sceneH}; transform-origin: 0 0; transform: translate(${panX}px, ${panY}px) scale(${zoom});`}
      >
        <!-- Background -->
        <div
          class="absolute inset-0 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950"
          style={currentFrameData?.image ? `background-image:
            linear-gradient(45deg, #1a1a1a 25%, transparent 25%),
            linear-gradient(-45deg, #1a1a1a 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #1a1a1a 75%),
            linear-gradient(-45deg, transparent 75%, #1a1a1a 75%);
            background-size: 16px 16px;
            background-position: 0 0, 0 8px, 8px -8px, -8px 0px;` : ''}
        ></div>

        <!-- Rendered frame -->
        {#if sceneInvalid}
          <!-- Invalid timeline range — shown first so it always wins over stale frame/spinner -->
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6">
            <p class="text-xs text-red-500 text-center">Fix the timeline range — start must be less than end</p>
          </div>
        {:else if currentFrameData?.image}
          <div class="absolute inset-0 rounded-lg overflow-hidden">
            <PreviewCanvas
              frameDataUrl={currentFrameData.image}
              sceneWidth={sceneW}
              sceneHeight={sceneH}
            />
          </div>
        {:else if fetchError}
          <!-- Error state -->
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
            <svg class="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
            <p class="text-xs text-red-400 text-center leading-relaxed">{fetchError}</p>
            <button
              class="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded px-3 py-1 transition-colors"
              onclick={() => {
                fetchError = null
                clearBuffer()
                const fps = app.previewFps ?? 1
                const start = app.config?.scene?.start ?? 0
                fetchFrame(secToFrameIdx(app.selectedSecond, fps, start))
              }}
            >Retry</button>
          </div>
        {:else}
          <!-- Generating preview -->
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <svg class="h-5 w-5 text-zinc-600 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <p class="text-xs text-zinc-600">{previewNotice ?? 'Generating preview…'}</p>
          </div>
        {/if}

        <!-- WYSIWYG drag layer — always on top -->
        <WysiwygLayer
          measuredElements={currentFrameData?.elements ?? []}
          frameImage={currentFrameData?.image ?? null}
          {zoom}
        />

      </div>
    {:else}
      <!-- No template loaded -->
      <div class="flex flex-col items-center gap-3 text-center">
        <div class="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center">
          <svg class="w-6 h-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
        </div>
        <p class="text-sm text-zinc-500">Select a template to start</p>
      </div>
    {/if}
  </div>

  <!-- Playback controls (fixed at bottom of canvas area) -->
  <PlaybackControls
    bind:playhead={app.selectedSecond}
    start={sceneStart}
    end={sceneEnd}
    bind:playing
    bind:previewFps={app.previewFps}
    buffered={bufferedSeconds}
    onseek={seek}
    distanceInfo={(showDistanceBar || showCourseMarkerBar) ? distanceInfo : null}
    customDistanceM={showDistanceBar ? customDistanceM : null}
    oncustomdistancechange={onCustomDistanceChange}
    markerDistanceM={showCourseMarkerBar ? courseMarkerDistanceM : null}
    markerStyle={selectedCourseMarker?.style ?? 'checkered'}
    markerColor={selectedCourseMarker?.color ?? '#ef4444'}
    onmarkerdistancechange={onCourseMarkerDistanceChange}
  />
</main>
