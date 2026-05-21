<script>
  import { setContext, onMount } from 'svelte'
  import { open } from '@tauri-apps/plugin-dialog'
  import { listen } from '@tauri-apps/api/event'
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
  import TemplatePickerModal from './components/overlays/TemplatePickerModal.svelte'
  import ConfirmDialog from './components/overlays/ConfirmDialog.svelte'
  import NewTemplateDialog from './components/overlays/NewTemplateDialog.svelte'
  import Button from './components/ui/Button.svelte'
  import Tooltip from './components/ui/Tooltip.svelte'

  import { Activity, Play } from 'lucide-svelte'
  import { formatTime } from './lib/utils.js'

  // ── State ──────────────────────────────────────────────────────────────────
  const app = createAppState()
  setContext('app', app)

  let rendering = $state(false)
  let showSettings = $state(false)
  let showNewTemplateDialog = $state(false)
  let buildInfo = $state('')
  function onWindowKeydown(e) {
    const t = e.target
    const inField =
      t?.tagName === 'INPUT' ||
      t?.tagName === 'TEXTAREA' ||
      t?.tagName === 'SELECT' ||
      t?.isContentEditable
    const blocked = showSettings || app.showTemplatePicker || showNewTemplateDialog

    // Undo (⌘/Ctrl+Z). Skip when typing in a field so native text undo works.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      if (inField || blocked || !app.canUndo) return
      e.preventDefault()
      app.undo()
      return
    }

    // Redo (⌘/Ctrl+Shift+Z or Ctrl+Y). Same in-field skip as undo.
    if (
      (e.metaKey || e.ctrlKey) &&
      ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')
    ) {
      if (inField || blocked || !app.canRedo) return
      e.preventDefault()
      app.redo()
      return
    }

    // Copy element (⌘/Ctrl+C). Only when an element is selected and not in a text field.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      if (inField || blocked || !app.selectedElementId) return
      e.preventDefault()
      app.copyElement()
      return
    }

    // Paste element clone (⌘/Ctrl+V).
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
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
    if (import.meta.env.DEV) backend.appBuildInfo().then(s => { buildInfo = s }).catch(() => {})

    if (typeof window.__TAURI__ !== 'undefined') {
      const unlisteners = [
        listen('menu_open_gpx',         () => handleOpenGpx()),
        listen('menu_open_recent_gpx',  (e) => handleOpenRecentGpx(e.payload)),
        listen('menu_save_template',    () => app.saveTemplate().catch(e => { app.errorMessage = e.message })),
        listen('menu_save_template_as', () => app.saveTemplateAs().catch(e => { app.errorMessage = e.message })),
        listen('menu_rename_template',  () => app.renameTemplate().catch(e => { app.errorMessage = e.message })),
        listen('menu_new_template',     () => app.confirmIfModified(() => { showNewTemplateDialog = true })),
        listen('menu_show_downloads',   () => handleOpenDownloads()),
        listen('menu_show_activities',  () => backend.openActivitiesFolder().catch(() => {})),
        listen('menu_show_templates',   () => backend.openTemplatesFolder().catch(() => {})),
        listen('menu_settings',         () => { showSettings = true }),
        listen('menu_undo',             () => { if (app.canUndo) app.undo() }),
        listen('menu_redo',             () => { if (app.canRedo) app.redo() }),
        listen('menu_copy',             () => { if (app.selectedElementId) app.copyElement() }),
        listen('menu_paste',            () => { if (app.copiedElement) app.pasteElement() }),
        listen('menu_browse_community_templates', () => { app.showTemplatePicker = true }),
        listen('menu_add_custom_font',  () => app.addCustomFont().catch(e => { app.errorMessage = e.message })),
      ]
      return () => unlisteners.forEach(p => p.then(fn => fn()))
    }
  })

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleOpenGpx() {
    try {
      const inTauri = typeof window.__TAURI__ !== 'undefined'
      if (inTauri) {
        const selected = await open({
          multiple: false,
          filters: [{ name: 'Activity (GPX, FIT, TCX)', extensions: ['gpx', 'fit', 'tcx'] }],
          title: 'Select Activity File',
        })
        if (!selected) return
        await loadGpx(selected, app)
        backend.recordGpxOpened(selected).catch(() => {})
        if (!app.config) {
          try {
            const def = await backend.getTemplate('default.json')
            app.config = def
            app.loadedTemplateFilename = 'default.json'
            app.updateScene({ start: 0, end: app.timelineDuration })
          } catch { /* use existing config */ }
        }
      } else {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.gpx,.fit,.tcx'
        input.onchange = async (e) => {
          const file = e.target.files?.[0]
          if (file) await loadGpx(file, app)
        }
        input.click()
      }
    } catch (err) {
      app.errorMessage = `Activity load failed: ${err.message}`
    }
  }

  async function handleOpenRecentGpx(path) {
    try {
      await loadGpx(path, app)
      backend.recordGpxOpened(path).catch(() => {})
      if (!app.config) {
        try {
          const def = await backend.getTemplate('default.json')
          app.config = def
          app.loadedTemplateFilename = 'default.json'
          app.updateScene({ start: 0, end: app.timelineDuration })
        } catch { /* use existing config */ }
      }
    } catch (err) {
      app.errorMessage = `Could not open ${path.split('/').pop()}: ${err.message}`
    }
  }

  async function handleRender() {
    if (rendering) return
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
    try { await backend.openDownloads(app.outputDir) } catch (e) {
      app.errorMessage = `Could not open output folder: ${e.message}`
    }
  }

  // Estimate render wall-clock time from the last recorded render FPS.
  // Re-evaluates whenever renderingVideo or config changes, so it picks up
  // the freshly-stored FPS right after a render finishes.
  let renderEstimateSecs = $derived.by(() => {
    if (app.renderingVideo || !app.config?.scene) return null
    const fps = app.config.scene.fps ?? 30
    const start = app.config.scene.start ?? 0
    const end = app.config.scene.end ?? app.timelineDuration
    if (start >= end) return null
    const renderFps = app.lastRenderFps
    if (!renderFps || renderFps <= 0) return null
    return Math.round(((end - start) * fps) / renderFps)
  })

  let gpxLabel = $derived.by(() => {
    if (!app.gpxFilename) return 'Load Activity'
    const basename = app.gpxFilename.split(/[\\/]/).pop()
    return basename === 'demo.gpxinit' ? 'Load Activity' : basename
  })
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="h-screen flex flex-col bg-[#09090b] text-foreground overflow-hidden select-none">
  <ErrorToast />
  <UpdateBanner />
  <RenderProgressOverlay />
  {#if showSettings}
    <Settings onclose={() => { showSettings = false }} />
  {/if}
  {#if app.showTemplatePicker}
    <TemplatePickerModal onclose={() => { app.showTemplatePicker = false }} />
  {/if}
  {#if showNewTemplateDialog}
    <NewTemplateDialog
      oncreate={async (name) => {
        showNewTemplateDialog = false
        await app.newTemplate(name).catch((e) => { app.errorMessage = e.message })
      }}
      oncancel={() => { showNewTemplateDialog = false }}
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

  <!-- ── Header ─────────────────────────────────────────────────────────────── -->
  <header class="h-12 shrink-0 border-b border-zinc-800 bg-zinc-900/60 backdrop-blur-sm flex items-center gap-3 px-4 z-50">
    <!-- Logo -->
    <div class="flex items-center gap-2.5 mr-2">
      <img src="/logo192.png" alt="" class="w-7 h-7 rounded-[6px]" />
      <span class="text-sm font-semibold tracking-tight">Cyclemetry</span>
    </div>

    <div class="h-5 w-px bg-zinc-800"></div>
    {#if buildInfo}<span class="text-[10px] text-zinc-600 font-mono">{buildInfo}</span>{/if}

    <!-- Activity file picker -->
    <Tooltip content={!app.gpxFilename ? 'Load a GPX, FIT, or TCX activity file' : gpxLabel} side="bottom">
      <Button variant="outline" size="sm" onclick={handleOpenGpx} class="gap-1.5 max-w-[160px]">
        <Activity size={13} />
        <span class="truncate">{gpxLabel}</span>
      </Button>
    </Tooltip>

    <div class="flex-1"></div>

    <!-- Render button + estimate -->
    <div class="flex items-center gap-2">
      {#if renderEstimateSecs != null}
        <span class="text-[11px] text-zinc-500 font-mono">~{formatTime(renderEstimateSecs)}</span>
      {/if}
      <Tooltip
        content={!app.config ? 'Load a template first' : app.renderingVideo ? 'Render in progress' : null}
        side="bottom"
      >
        <Button
          onclick={handleRender}
          disabled={!app.config || app.renderingVideo}
          class="gap-1.5"
          size="sm"
        >
          <Play size={13} />
          {app.renderingVideo ? 'Rendering…' : 'Render'}
        </Button>
      </Tooltip>
    </div>

  </header>

  <!-- ── Three-panel layout ─────────────────────────────────────────────────── -->
  <div class="flex-1 flex overflow-hidden min-h-0">
    <LeftSidebar />
    <CenterCanvas />
    <RightPanel />
  </div>
</div>
