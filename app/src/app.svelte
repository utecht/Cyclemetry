<script>
  import { setContext, onMount } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { createAppState } from './state/appState.svelte.js'
  import * as backend from './api/backend.js'
  import loadGpx from './api/gpxUtils.js'
  import renderVideo from './api/renderVideo.js'

  import LeftSidebar from './components/layout/LeftSidebar.svelte'
  import CenterCanvas from './components/layout/CenterCanvas.svelte'
  import RightPanel from './components/layout/RightPanel.svelte'
  import RenderProgressOverlay from './components/overlays/RenderProgressOverlay.svelte'
  import ErrorToast from './components/overlays/ErrorToast.svelte'
  import UpdateBanner from './components/overlays/UpdateBanner.svelte'
  import Settings from './components/overlays/Settings.svelte'
  import AboutModal from './components/overlays/AboutModal.svelte'
  import TemplatePickerModal from './components/overlays/TemplatePickerModal.svelte'
  import ActivityPickerModal from './components/overlays/ActivityPickerModal.svelte'
  import ConfirmDialog from './components/overlays/ConfirmDialog.svelte'
  import NewTemplateDialog from './components/overlays/NewTemplateDialog.svelte'
  import Button from './components/ui/Button.svelte'
  import Tooltip from './components/ui/Tooltip.svelte'

  import {
    Activity,
    AlertTriangle,
    Check,
    ChevronDown,
    Clock,
    Film,
    LayoutGrid,
    Monitor,
    Pencil,
    Play,
    RotateCcw,
    Save,
    X,
  } from 'lucide-svelte'
  import { formatTime, estimateProResFileSize, TOOLTIP_DELAY } from './lib/utils.js'
  import { wallClockApplicable } from './lib/videoAlignment.js'

  // ── State ──────────────────────────────────────────────────────────────────
  const app = createAppState()
  setContext('app', app)

  // ── Scene toolbar helpers ──────────────────────────────────────────────────
  const RES_PRESETS = [
    { label: '4K', w: 3840, h: 2160 },
    { label: '1080p', w: 1920, h: 1080 },
    { label: '4K Vertical', w: 2160, h: 3840 },
    { label: '1080p Vertical', w: 1080, h: 1920 },
    { label: 'Square', w: 1080, h: 1080 },
  ]

  // True when the user is in custom-resolution mode. Initialised to true when
  // the persisted dims don't match any preset (e.g. loaded from a prior session).
  let customResActive = $state(
    !RES_PRESETS.some(
      (p) => p.w === app.outputWidth && p.h === app.outputHeight,
    ),
  )
  let showResolutionMenu = $state(false)

  let resolutionLabel = $derived.by(() => {
    const preset = RES_PRESETS.find(
      (p) => p.w === app.outputWidth && p.h === app.outputHeight,
    )
    return preset ? preset.label : `${app.outputWidth}×${app.outputHeight}`
  })

  function onHeaderMousedown(e) {
    if (e.button !== 0) return
    if (e.target.closest('button, input, a, select, [role="button"]')) return
    getCurrentWindow().startDragging()
  }

  function videoBasename(path) {
    if (!path) return ''
    return path.split(/[\\/]/).pop()
  }

  function moveVideoToRecordingTime() {
    app.setVideoOffset(0)
  }

  function errorText(err, fallback = 'Unknown error') {
    if (typeof err === 'string') return err
    return err?.message ?? String(err ?? fallback)
  }

  function chooseResolution(preset) {
    app.outputWidth = preset.w
    app.outputHeight = preset.h
    customResActive = false
    showResolutionMenu = false
  }

  let canUseRecordingTime = $derived(
    app.hasActivity &&
      wallClockApplicable(app.gpxStartTime, app.video, app.timelineDuration),
  )

  // ── Template toolbar helpers ───────────────────────────────────────────────
  let renaming = $state(false)
  let renameValue = $state('')

  let templateLabel = $derived.by(() => {
    if (!app.loadedTemplateFilename) return null
    const t = (app.templates ?? []).find(
      (t) => t.id === app.loadedTemplateFilename,
    )
    return t?.name ?? app.loadedTemplateFilename.replace('.json', '')
  })

  function startRename() {
    if (!app.loadedTemplateFilename) return
    renameValue =
      templateLabel ?? app.loadedTemplateFilename.replace('.json', '')
    renaming = true
  }

  function cancelRename() {
    renaming = false
    renameValue = ''
  }

  async function submitRename() {
    try {
      await app.renameTemplate(renameValue)
      cancelRename()
    } catch (e) {
      app.errorMessage = e?.message ?? String(e)
    }
  }

  let rendering = $state(false)
  let showSettings = $state(false)
  let showAbout = $state(false)
  let showNewTemplateDialog = $state(false)
  let showActivityPicker = $state(false)

  function closeDialogs() {
    showActivityPicker = false
    showSettings = false
    showAbout = false
    showNewTemplateDialog = false
    app.showTemplatePicker = false
  }

  function openTemplatePicker() {
    closeDialogs()
    app.showTemplatePicker = true
  }

  function openActivityPicker() {
    closeDialogs()
    showActivityPicker = true
  }

  function openSettings() {
    closeDialogs()
    showSettings = true
  }

  function openAbout() {
    closeDialogs()
    showAbout = true
  }

  function openNewTemplateDialog() {
    closeDialogs()
    showNewTemplateDialog = true
  }

  // Enforce mutual exclusion: any code path that sets showTemplatePicker = true
  // (including child components that bypass openTemplatePicker) must close other dialogs.
  $effect(() => {
    if (app.showTemplatePicker) {
      showActivityPicker = false
      showSettings = false
      showAbout = false
      showNewTemplateDialog = false
    }
  })

  let showRevertConfirm = $state(false)

  const REVERT_SKIP_KEY = 'confirm_skip_revert_template'
  const RENDERED_ONCE_KEY = 'has_rendered_once'
  let hasRenderedOnce = $state(
    localStorage.getItem(RENDERED_ONCE_KEY) === 'true',
  )

  function handleRevertClick() {
    if (localStorage.getItem(REVERT_SKIP_KEY) === 'true') {
      app.revertTemplate().catch((e) => {
        app.errorMessage = e?.message ?? String(e)
      })
    } else {
      showRevertConfirm = true
    }
  }
  function onWindowKeydown(e) {
    const t = e.target
    const inField =
      t?.tagName === 'INPUT' ||
      t?.tagName === 'TEXTAREA' ||
      t?.tagName === 'SELECT' ||
      t?.isContentEditable
    const blocked =
      showSettings ||
      app.showTemplatePicker ||
      showNewTemplateDialog ||
      showActivityPicker

    if (e.key === 'Escape' && showResolutionMenu) {
      showResolutionMenu = false
      return
    }

    // Undo (⌘/Ctrl+Z). Skip when typing in a field so native text undo works.
    if (
      (e.metaKey || e.ctrlKey) &&
      !e.shiftKey &&
      (e.key === 'z' || e.key === 'Z')
    ) {
      if (inField || blocked || !app.canUndo) return
      e.preventDefault()
      app.undo()
      return
    }

    // Redo (⌘/Ctrl+Shift+Z or Ctrl+Y). Same in-field skip as undo.
    if (
      (e.metaKey || e.ctrlKey) &&
      ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
        e.key === 'y' ||
        e.key === 'Y')
    ) {
      if (inField || blocked || !app.canRedo) return
      e.preventDefault()
      app.redo()
      return
    }

    // Copy element (⌘/Ctrl+C). Only when an element is selected and not in a text field.
    if (
      (e.metaKey || e.ctrlKey) &&
      !e.shiftKey &&
      (e.key === 'c' || e.key === 'C')
    ) {
      if (inField || blocked || !app.selectedElementId) return
      e.preventDefault()
      app.copyElement()
      return
    }

    // Paste element clone (⌘/Ctrl+V).
    if (
      (e.metaKey || e.ctrlKey) &&
      !e.shiftKey &&
      (e.key === 'v' || e.key === 'V')
    ) {
      if (inField || blocked || !app.copiedElement) return
      e.preventDefault()
      app.pasteElement()
      return
    }

    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    if (blocked || inField) return
    if (!app.selectedElementId) return
    e.preventDefault()
    app.deleteSelectedElement()
  }

  onMount(() => {
    app.fetchTemplates()
    app.fetchFonts()
    app.fetchDefaultOutputDir()
    app.verifyVideo()
    if (typeof window.__TAURI__ !== 'undefined') {
      const unlisteners = [
        listen('menu_open_gpx', () => handleOpenGpx()),
        listen('menu_open_recent_gpx', (e) => handleOpenRecentGpx(e.payload)),
        listen('menu_save_template', () =>
          app.saveTemplate().catch((e) => {
            app.errorMessage = e.message
          }),
        ),
        listen('menu_new_template', () =>
          app.confirmIfModified(() => {
            openNewTemplateDialog()
          }),
        ),
        listen('menu_show_downloads', () => handleOpenDownloads()),
        listen('menu_show_activities', () =>
          backend.openActivitiesFolder().catch(() => {}),
        ),
        listen('menu_open_templates_folder', () =>
          backend.openTemplatesFolder().catch(() => {}),
        ),
        listen('menu_settings', () => {
          openSettings()
        }),
        listen('menu_about', () => {
          openAbout()
        }),
        listen('menu_undo', () => {
          if (app.canUndo) app.undo()
        }),
        listen('menu_redo', () => {
          if (app.canRedo) app.redo()
        }),
        listen('menu_copy', () => {
          if (app.selectedElementId) app.copyElement()
        }),
        listen('menu_paste', () => {
          if (app.copiedElement) app.pasteElement()
        }),
        listen('menu_show_template_dialog', () => {
          openTemplatePicker()
        }),
        listen('menu_add_custom_font', () =>
          app.addCustomFont().catch((e) => {
            app.errorMessage = e.message
          }),
        ),
        listen('menu_add_video', () =>
          app.pickAndLoadVideo().catch((e) => {
            app.errorMessage = e.message
          }),
        ),
        listen('menu_dev_reset', async () => {
          await backend.devClearCache().catch(() => {})
          sessionStorage.setItem('dev_reset', '1')
          window.location.reload()
        }),
      ]
      return () => unlisteners.forEach((p) => p.then((fn) => fn()))
    }
  })

  // ── Actions ────────────────────────────────────────────────────────────────
  // Open the picker (Tauri) or fall back to a browser file input (web preview).
  async function handleOpenGpx() {
    const inTauri = typeof window.__TAURI__ !== 'undefined'
    if (inTauri) {
      openActivityPicker()
      return
    }
    closeDialogs()
    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.gpx,.fit,.tcx'
      input.onchange = async (e) => {
        const file = e.target.files?.[0]
        if (file) await loadGpx(file, app)
      }
      input.click()
    } catch (err) {
      app.errorMessage = `Activity load failed: ${errorText(err)}`
    }
  }

  /**
   * Load an activity from either an absolute path (string, from the native
   * dialog) or a previously saved uploads-dir entry ({ savedFilename }).
   * Called by ActivityPickerModal and by the macOS recent menu.
   */
  async function loadActivityFromPickerOrMenu(source) {
    if (typeof source === 'string') {
      await loadGpx(source, app)
      backend.recordGpxOpened(source).catch(() => {})
    } else {
      const filename = source.savedFilename
      const stored = await backend.loadSavedActivity(filename)
      const result = typeof stored === 'string' ? JSON.parse(stored) : stored
      if (result.error) throw new Error(result.error)
      app.gpxFilename = result.filename ?? filename
      app.gpxStartTime = result.start_time ?? null
      app.activityDuration = result.duration_seconds
      app.selectedSecond = 0
      if (app.config?.scene) {
        app.updateScene({ start: 0, end: app.timelineDuration })
      }
    }
    if (!app.config) {
      try {
        const def = await backend.getTemplate('default.json')
        app.config = def
        app.loadedTemplateFilename = 'default.json'
        app.updateScene({ start: 0, end: app.timelineDuration })
      } catch {
        /* use existing config */
      }
    }
  }

  async function handleOpenRecentGpx(path) {
    try {
      await loadActivityFromPickerOrMenu(path)
    } catch (err) {
      app.errorMessage = `Could not open ${path.split('/').pop()}: ${errorText(err)}`
    }
  }

  async function handleRender() {
    if (rendering || !app.hasActivity) return
    if (!hasRenderedOnce) {
      hasRenderedOnce = true
      localStorage.setItem(RENDERED_ONCE_KEY, 'true')
    }
    rendering = true
    try {
      const result = await renderVideo(app)
      if (result?.cancelled) console.log('Render cancelled')
    } catch (err) {
      app.errorMessage = err.message ?? 'Render failed'
    } finally {
      rendering = false
    }
  }

  async function handleOpenDownloads() {
    try {
      await backend.openDownloads(app.outputDir)
    } catch (e) {
      app.errorMessage = `Could not open output folder: ${e.message}`
    }
  }

  // Estimate render wall-clock time from the last recorded render FPS.
  // Re-evaluates whenever renderingVideo or config changes, so it picks up
  // the freshly-stored FPS right after a render finishes.
  let renderEstimateSecs = $derived.by(() => {
    if (app.renderingVideo || !app.config?.scene || !app.hasActivity)
      return null
    const fps = app.config.scene.fps ?? 30
    const start = app.config.scene.start ?? 0
    const end = app.config.scene.end ?? app.timelineDuration
    if (start >= end) return null
    const renderFps = app.lastRenderFps
    if (!renderFps || renderFps <= 0) return null
    return Math.round(((end - start) * fps) / renderFps)
  })

  let renderFileSizeEst = $derived.by(() => {
    if (!app.config?.scene || !app.hasActivity) return null
    const fps = app.config.scene.fps ?? 30
    const start = app.config.scene.start ?? 0
    const end = app.config.scene.end ?? app.timelineDuration
    const duration = end - start
    if (duration <= 0) return null
    return estimateProResFileSize(
      app.outputWidth,
      app.outputHeight,
      fps,
      duration,
      app.exportSizeCalibration,
    )
  })

  let renderTooltip = $derived.by(() => {
    if (!app.config) return 'Load a template first'
    if (!app.hasActivity) return 'Load an activity first'
    if (app.renderingVideo) return 'Render in progress'
    const lines = []
    if (renderEstimateSecs != null)
      lines.push(`~${formatTime(renderEstimateSecs)} to render`)
    if (renderFileSizeEst != null) lines.push(`~${renderFileSizeEst} output`)
    return lines.length > 0 ? lines.join('\n') : null
  })

  let gpxLabel = $derived.by(() => {
    if (!app.gpxFilename) return 'Load Activity'
    return app.gpxFilename.split(/[\\/]/).pop()
  })

  // 1 = no template, 2 = template but no activity, 0 = ready
  let onboardingStep = $derived.by(() => {
    if (!app.config) return 1
    if (!app.hasActivity) return 2
    return 0
  })
</script>

<svelte:window
  onkeydown={onWindowKeydown}
  onclick={() => {
    showResolutionMenu = false
  }}
/>

<div
  class="h-screen flex flex-col bg-[#09090b] text-foreground overflow-hidden select-none"
>
  <ErrorToast />
  <UpdateBanner />
  <RenderProgressOverlay />
  {#if showSettings}
    <Settings
      onclose={() => {
        showSettings = false
      }}
    />
  {/if}
  {#if showAbout}
    <AboutModal onclose={() => (showAbout = false)} />
  {/if}
  {#if app.showTemplatePicker}
    <TemplatePickerModal
      onclose={() => {
        app.showTemplatePicker = false
      }}
    />
  {/if}
  {#if showActivityPicker}
    <ActivityPickerModal
      onload={loadActivityFromPickerOrMenu}
      onclose={() => {
        showActivityPicker = false
      }}
    />
  {/if}
  {#if showNewTemplateDialog}
    <NewTemplateDialog
      oncreate={async (name) => {
        showNewTemplateDialog = false
        await app.newTemplate(name).catch((e) => {
          app.errorMessage = e.message
        })
      }}
      oncancel={() => {
        showNewTemplateDialog = false
      }}
    />
  {/if}
  {#if app.pendingDiscard}
    <ConfirmDialog
      title="Discard unsaved changes?"
      message="This template has unsaved edits. Switching will lose them. Save the template first if you want to reuse it."
      confirmText="Discard"
      cancelText="Keep editing"
      onconfirm={() => app.resolvePendingDiscard(true)}
      oncancel={() => app.resolvePendingDiscard(false)}
    />
  {/if}
  {#if showRevertConfirm}
    <ConfirmDialog
      title="Revert template?"
      message="This will discard all unsaved changes and reload the last saved version. This cannot be undone."
      confirmText="Revert"
      cancelText="Keep editing"
      dontShowAgainLabel="Don't ask again"
      onconfirm={(skip) => {
        if (skip) localStorage.setItem(REVERT_SKIP_KEY, 'true')
        showRevertConfirm = false
        app.revertTemplate().catch((e) => {
          app.errorMessage = e?.message ?? String(e)
        })
      }}
      oncancel={() => {
        showRevertConfirm = false
      }}
    />
  {/if}

  <!-- ── Header ─────────────────────────────────────────────────────────────── -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header
    onmousedown={onHeaderMousedown}
    class="h-14 shrink-0 border-b border-zinc-800 bg-zinc-900/60 backdrop-blur-sm flex items-center gap-3 pr-4 pl-[96px] z-50"
  >
    <!-- ── Template toolbar ─────────────────────────────────────────────────── -->
    <div class="flex items-center gap-1 shrink-0">
      {#if renaming}
        <form
          class="flex items-center gap-1"
          onsubmit={(e) => {
            e.preventDefault()
            submitRename()
          }}
        >
          <input
            bind:value={renameValue}
            class="h-7 w-36 rounded-[6px] border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100
                   focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Template name"
          />
          <button
            type="submit"
            title="Confirm rename"
            class="hdr-btn hdr-btn-icon"><Check size={12} /></button
          >
          <button
            type="button"
            onclick={cancelRename}
            title="Cancel"
            class="hdr-btn hdr-btn-icon"><X size={12} /></button
          >
        </form>
      {:else}
        <!-- Template picker -->
        <Tooltip content="Choose a template" side="bottom" delay={TOOLTIP_DELAY}>
          <button
            onclick={() => {
              openTemplatePicker()
            }}
            class="hdr-btn px-2.5 gap-1.5 max-w-[170px] min-w-0 {onboardingStep ===
            1
              ? 'onboarding-glow'
              : ''}"
          >
            <LayoutGrid size={12} class="text-zinc-500 shrink-0" />
            <span
              class="truncate {templateLabel ? 'text-zinc-200' : 'text-zinc-500'}"
            >
              {templateLabel ?? 'Templates…'}
            </span>
            {#if app.isTemplateModified}
              <span class="text-amber-400 shrink-0" title="Unsaved changes"
                >•</span
              >
            {/if}
          </button>
        </Tooltip>

        <!-- Rename -->
        {#if app.loadedTemplateFilename}
          <Tooltip content="Rename template" side="bottom" delay={TOOLTIP_DELAY}>
            <button
              onclick={startRename}
              class="hdr-btn hdr-btn-icon shrink-0"><Pencil size={12} /></button
            >
          </Tooltip>
        {/if}

        <!-- Save — amber when modified -->
        {#if app.isTemplateModified}
          <Tooltip content="Save template" side="bottom" delay={TOOLTIP_DELAY}>
            <button
              onclick={() =>
                app.saveTemplate().catch((e) => {
                  app.errorMessage = e?.message ?? String(e)
                })}
              class="hdr-btn hdr-btn-icon shrink-0 border-amber-500/60 bg-amber-500/10 text-amber-400
                     hover:border-amber-400 hover:bg-amber-500/20 hover:text-amber-300"
              ><Save size={12} /></button
            >
          </Tooltip>

          <!-- Revert to last saved -->
          <Tooltip content="Revert to last saved" side="bottom" delay={TOOLTIP_DELAY}>
            <button
              onclick={handleRevertClick}
              class="hdr-btn hdr-btn-icon shrink-0"
              ><RotateCcw size={12} /></button
            >
          </Tooltip>
        {/if}
      {/if}
    </div>

    <div class="h-5 w-px bg-zinc-800 shrink-0"></div>

    <!-- Activity file picker -->
    <Tooltip content="Choose an activity" side="bottom" delay={TOOLTIP_DELAY}>
      <button
        onclick={handleOpenGpx}
        class="hdr-btn px-2.5 gap-1.5 max-w-[160px] {onboardingStep === 2
          ? 'onboarding-glow'
          : ''}"
      >
        <Activity size={12} class="shrink-0" />
        <span class="truncate">{gpxLabel}</span>
      </button>
    </Tooltip>

    <!-- Video — always shown, dashed border signals optional -->
    <div class="h-5 w-px bg-zinc-800 shrink-0"></div>
    {#if !app.video}
      <Tooltip
        content="Adding video is only for preview. The exported overlay will not include the video."
        side="bottom"
        class="shrink-0"
      >
        <button
          onclick={() => app.pickAndLoadVideo()}
          class="hdr-btn px-2.5 gap-1.5 border-dashed"
        >
          <Film size={12} class="shrink-0" />
          Add video…
        </button>
      </Tooltip>
    {:else if app.video.missing}
      <div class="flex items-center gap-1 shrink-0">
        <AlertTriangle size={12} class="text-red-400 shrink-0" />
        <span
          class="text-xs font-mono text-red-300 truncate max-w-[100px]"
          title={app.video.path}>{videoBasename(app.video.path)}</span
        >
        <button
          onclick={() => app.pickAndLoadVideo()}
          class="hdr-btn px-2.5 border-red-800/60 text-red-300 hover:border-red-600/60 hover:bg-red-900/30 hover:text-red-200"
          >Locate…</button
        >
        <button
          onclick={() => app.clearVideo()}
          class="hdr-btn hdr-btn-icon shrink-0"><X size={12} /></button
        >
      </div>
    {:else}
      <div class="flex items-center gap-1 shrink-0">
        <Film size={12} class="text-zinc-500 shrink-0" />
        <span
          class="text-xs font-mono text-zinc-300 truncate max-w-[130px]"
          title={app.video.path}>{videoBasename(app.video.path)}</span
        >
        {#if canUseRecordingTime}
          <button
            onclick={moveVideoToRecordingTime}
            title="Align to camera recording time"
            class="hdr-btn hdr-btn-icon shrink-0"><Clock size={12} /></button
          >
        {/if}
        <button onclick={() => app.pickAndLoadVideo()} class="hdr-btn px-2.5"
          >Replace…</button
        >
        <button
          onclick={() => app.clearVideo()}
          class="hdr-btn hdr-btn-icon shrink-0"><X size={12} /></button
        >
      </div>
    {/if}

    <!-- ── Scene toolbar: resolution + FPS (shown when a template is loaded) ── -->
    {#if app.config?.scene}
      <div class="h-5 w-px bg-zinc-800 shrink-0"></div>

      <!-- Resolution popover -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="relative shrink-0" onclick={(e) => e.stopPropagation()}>
        <Tooltip content="Choose output resolution" side="bottom" delay={TOOLTIP_DELAY}>
          <button
            type="button"
            onclick={() => {
              showResolutionMenu = !showResolutionMenu
            }}
            class="hdr-btn px-2.5 gap-1.5 min-w-[112px] justify-between {showResolutionMenu
              ? 'border-zinc-500 bg-zinc-800 text-zinc-200'
              : ''}"
            aria-haspopup="menu"
            aria-expanded={showResolutionMenu}
          >
            <span class="inline-flex items-center gap-1.5 min-w-0">
              <Monitor size={12} class="text-zinc-500 shrink-0" />
              <span class="truncate">{resolutionLabel}</span>
            </span>
            <ChevronDown size={12} class="text-zinc-600 shrink-0" />
          </button>
        </Tooltip>

        {#if showResolutionMenu}
          <div
            class="resolution-popover absolute left-0 top-[calc(100%+6px)] z-[80] w-56 rounded-[8px] border border-zinc-700 bg-zinc-950/98 p-2 shadow-2xl shadow-black/50"
            role="menu"
          >
            <div class="grid grid-cols-2 gap-1">
              {#each RES_PRESETS as p (p.label)}
                {@const active =
                  !customResActive &&
                  app.outputWidth === p.w &&
                  app.outputHeight === p.h}
                <button
                  type="button"
                  onclick={() => chooseResolution(p)}
                  class="resolution-option {active
                    ? 'resolution-option--active'
                    : ''}"
                  role="menuitem"
                >
                  <span class="font-medium">{p.label}</span>
                  <span class="font-mono text-[10px] text-zinc-500"
                    >{p.w}×{p.h}</span
                  >
                </button>
              {/each}
            </div>

            <div class="mt-2 border-t border-zinc-800 pt-2">
              <button
                type="button"
                onclick={() => {
                  customResActive = true
                }}
                class="resolution-option w-full {customResActive
                  ? 'resolution-option--active'
                  : ''}"
              >
                <span class="font-medium">Custom</span>
                <span class="font-mono text-[10px] text-zinc-500"
                  >{app.outputWidth}×{app.outputHeight}</span
                >
              </button>

              <div class="mt-2 flex items-center gap-1.5">
                <input
                  type="number"
                  value={app.outputWidth}
                  min={1}
                  onfocus={() => {
                    customResActive = true
                  }}
                  oninput={(e) => {
                    customResActive = true
                    const v = parseInt(e.target.value)
                    if (v > 0) app.outputWidth = v
                  }}
                  class="h-7 min-w-0 flex-1 rounded-[6px] border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring {customResActive
                    ? 'border-zinc-700 bg-zinc-900 text-foreground'
                    : 'border-zinc-800 bg-zinc-950/70 text-zinc-500'}"
                  aria-label="Output width"
                />
                <span class="text-zinc-600 text-xs">×</span>
                <input
                  type="number"
                  value={app.outputHeight}
                  min={1}
                  onfocus={() => {
                    customResActive = true
                  }}
                  oninput={(e) => {
                    customResActive = true
                    const v = parseInt(e.target.value)
                    if (v > 0) app.outputHeight = v
                  }}
                  class="h-7 min-w-0 flex-1 rounded-[6px] border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring {customResActive
                    ? 'border-zinc-700 bg-zinc-900 text-foreground'
                    : 'border-zinc-800 bg-zinc-950/70 text-zinc-500'}"
                  aria-label="Output height"
                />
              </div>
            </div>
          </div>
        {/if}
      </div>

      {#if app.hasActivity}
        <div class="h-5 w-px bg-zinc-800 shrink-0"></div>

        <!-- FPS -->
        <div class="flex items-center gap-1.5 shrink-0">
          <span class="text-xs text-zinc-500">FPS</span>
          <input
            type="number"
            min="1"
            max="240"
            value={app.config.scene.fps ?? 30}
            oninput={(e) => {
              const v = parseInt(e.target.value)
              if (v > 0) app.updateScene({ fps: v })
            }}
            class="h-7 w-14 rounded-[6px] border border-zinc-700 bg-zinc-800/60 px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
          />
        </div>
      {/if}
    {/if}

    <div class="flex-1"></div>

    <!-- Render button -->
    <div class="flex items-center gap-2">
      <Tooltip content={renderTooltip} side="bottom" align="end">
        <Button
          onclick={handleRender}
          disabled={!app.config || !app.hasActivity || app.renderingVideo}
          class="gap-1.5 min-w-[104px] border border-primary/70 bg-primary/15 text-zinc-100 hover:border-primary hover:bg-primary/25 {onboardingStep ===
            0 && !hasRenderedOnce
            ? 'onboarding-glow'
            : ''}"
          size="sm"
        >
          <Play size={13} />
          {app.renderingVideo ? 'Rendering…' : 'Render Video'}
        </Button>
      </Tooltip>
    </div>
  </header>

  <!-- ── Three-panel layout ─────────────────────────────────────────────────── -->
  <div class="flex-1 flex overflow-hidden min-h-0">
    {#if app.config && app.hasActivity}
      <LeftSidebar />
    {/if}
    <CenterCanvas onopenactivity={handleOpenGpx} />
    {#if app.config && app.selectedElementId}
      <RightPanel />
    {/if}
  </div>
</div>
