import { open } from '@tauri-apps/plugin-dialog'
import * as backend from '../api/backend.js'
import { parseLocalStorage } from '../lib/utils.js'
import { elementTypeName } from '../lib/elementTypes.js'

export function createAppState() {
  // ── Persistent ──────────────────────────────────────────────────────────────
  // config is the single source of truth: scene settings + all element positions
  let _persisted = parseLocalStorage('editorConfig')
  // Drop a pre-unified persisted config (old labels/values/plots shape); the
  // app reloads a template fresh rather than migrating stale localStorage.
  if (
    _persisted &&
    !Array.isArray(_persisted.elements) &&
    (_persisted.labels || _persisted.values || _persisted.plots)
  ) {
    _persisted = null
  }
  const initialConfig = _persisted
  let config = $state(initialConfig)
  const _storedGpx = localStorage.getItem('gpxFilename')
  let gpxFilename = $state(
    _storedGpx && _storedGpx !== 'null' && _storedGpx !== 'undefined'
      ? _storedGpx
      : null,
  )
  let activityDuration = $state(
    parseInt(localStorage.getItem('activityDuration') ?? '73'),
  )
  let selectedSecond = $state(
    parseInt(localStorage.getItem('selectedSecond') ?? '0'),
  )
  let loadedTemplateFilename = $state(
    localStorage.getItem('loadedTemplateFilename') ?? null,
  )
  let outputDir = $state(localStorage.getItem('outputDir') ?? null)
  let defaultOutputDir = $state(null)
  let outputWidth = $state(
    parseInt(localStorage.getItem('outputWidth') ?? '1920'),
  )
  let outputHeight = $state(
    parseInt(localStorage.getItem('outputHeight') ?? '1080'),
  )
  // Snapshot of `config` as it was last loaded/saved. Used to detect unsaved
  // template edits. Output resolution lives outside `config`, so switching a
  // 1080p template into a 4K view never marks it modified.
  let pristineConfig = $state(
    localStorage.getItem('pristineConfig') ??
      (initialConfig ? JSON.stringify(initialConfig) : null),
  )

  // ── Transient ────────────────────────────────────────────────────────────────
  let copiedElement = $state(null) // the copied element object — in-memory clipboard
  let previewFps = $state(parseInt(localStorage.getItem('previewFps') ?? '5'))
  let benchmarking = $state(false)
  let lastRenderFps = $state(
    parseFloat(localStorage.getItem('lastRenderFps') ?? '') || null,
  )
  let renderingVideo = $state(false)
  let currentPreviewImage = $state(null) // data:image/png;base64,... from latest demo frame
  let errorMessage = $state(null)
  let successMessage = $state(null)
  let successTimer = null
  let templates = $state([])
  let fonts = $state([])
  let showTemplatePicker = $state(false)
  let selectedElementId = $state(null)
  let selectedElementIds = $state([])
  let selectedGroupId = $state(null)
  let renderProgress = $state({
    current: 0,
    total: 0,
    percent: 0,
    status: 'idle',
    estimatedSecondsRemaining: null,
    overlaySecondsRendered: 0,
    overlayTotalSeconds: 0,
  })

  // ── Persistence effects ───────────────────────────────────────────────────
  $effect(() => {
    if (config) localStorage.setItem('editorConfig', JSON.stringify(config))
  })
  $effect(() => {
    if (gpxFilename) localStorage.setItem('gpxFilename', gpxFilename)
    else localStorage.removeItem('gpxFilename')
  })
  $effect(() => {
    localStorage.setItem('activityDuration', String(activityDuration))
  })
  $effect(() => {
    localStorage.setItem('selectedSecond', String(selectedSecond))
  })
  $effect(() => {
    if (loadedTemplateFilename)
      localStorage.setItem('loadedTemplateFilename', loadedTemplateFilename)
  })
  $effect(() => {
    if (outputDir) localStorage.setItem('outputDir', outputDir)
    else localStorage.removeItem('outputDir')
  })
  $effect(() => {
    localStorage.setItem('outputWidth', String(outputWidth))
  })
  $effect(() => {
    localStorage.setItem('outputHeight', String(outputHeight))
  })
  $effect(() => {
    if (pristineConfig != null)
      localStorage.setItem('pristineConfig', pristineConfig)
    else localStorage.removeItem('pristineConfig')
  })
  $effect(() => {
    localStorage.setItem('previewFps', String(previewFps))
  })

  function markPristine() {
    pristineConfig = config ? JSON.stringify(config) : null
  }

  function templateModified() {
    return (
      !!config &&
      pristineConfig != null &&
      JSON.stringify(config) !== pristineConfig
    )
  }

  // Pending "discard unsaved edits?" action. When set, app.svelte shows a
  // ConfirmDialog; running or clearing it resolves the gate.
  let pendingDiscard = $state(null)

  function confirmIfModified(run) {
    if (templateModified()) pendingDiscard = run
    else run()
  }

  async function fetchDefaultOutputDir() {
    try {
      defaultOutputDir = await backend.defaultOutputDir()
    } catch {
      defaultOutputDir = null
    }
  }

  function resolvePendingDiscard(ok) {
    const run = pendingDiscard
    pendingDiscard = null
    showTemplatePicker = false
    if (ok && run) run()
  }

  // ── Selection ─────────────────────────────────────────────────────────────
  // selectedElementId is the "primary" element (drives the properties panel);
  // selectedElementIds is the full set for shift-click multi-select + group drag.

  function selectOnly(id) {
    selectedGroupId = null
    selectedElementId = id
    selectedElementIds = id ? [id] : []
  }

  function setSelectedElements(ids) {
    selectedElementIds = [...ids]
    selectedElementId = ids.length ? ids[ids.length - 1] : null
  }

  function toggleElementSelection(id) {
    if (selectedElementIds.includes(id)) {
      selectedElementIds = selectedElementIds.filter((x) => x !== id)
      if (selectedElementId === id) {
        selectedElementId =
          selectedElementIds[selectedElementIds.length - 1] ?? null
      }
    } else {
      selectedElementIds = [...selectedElementIds, id]
      selectedElementId = id
    }
  }

  // ── Undo history ──────────────────────────────────────────────────────────
  // Snapshots of `config` taken just before each edit. Template load/new and
  // wholesale config replacement clear it (you can't undo across a switch).
  const HISTORY_LIMIT = 50
  let history = $state([])
  let redoStack = $state([])

  // Apply an edit, recording the pre-edit config so it can be undone.
  // A fresh edit invalidates the redo stack.
  function commitConfig(next) {
    if (config) {
      history = [...history.slice(-(HISTORY_LIMIT - 1)), JSON.stringify(config)]
    }
    redoStack = []
    config = next
  }

  function resetHistory() {
    history = []
    redoStack = []
  }

  function undo() {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    history = history.slice(0, -1)
    if (config)
      redoStack = [
        ...redoStack.slice(-(HISTORY_LIMIT - 1)),
        JSON.stringify(config),
      ]
    config = JSON.parse(prev)
  }

  function redo() {
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    redoStack = redoStack.slice(0, -1)
    if (config)
      history = [...history.slice(-(HISTORY_LIMIT - 1)), JSON.stringify(config)]
    config = JSON.parse(next)
  }

  // ── Config mutation helpers ───────────────────────────────────────────────

  function updateScene(updates) {
    if (!config?.scene) return
    commitConfig({ ...config, scene: { ...config.scene, ...updates } })
  }

  // Find an element by stable id. Returns { idx, el } or null.
  function findElement(id, src = config) {
    const idx = src?.elements?.findIndex((e) => e.id === id) ?? -1
    return idx < 0 ? null : { idx, el: src.elements[idx] }
  }

  function updateElement(id, updates) {
    const found = findElement(id)
    if (!found) return
    const elements = [...config.elements]
    elements[found.idx] = { ...found.el, ...updates }
    commitConfig({ ...config, elements })
  }

  function updateElementPos(id, x, y) {
    updateElement(id, { x: Math.round(x), y: Math.round(y) })
  }

  // Apply position moves ({ id, x, y }) to a config, returning the next config
  // (same ref if nothing changed). Shared by the three drag entry points.
  function applyMoves(base, moves) {
    if (!base?.elements || moves.length === 0) return base
    const elements = [...base.elements]
    let touched = false
    for (const m of moves) {
      const i = elements.findIndex((e) => e.id === m.id)
      if (i < 0) continue
      elements[i] = { ...elements[i], x: Math.round(m.x), y: Math.round(m.y) }
      touched = true
    }
    return touched ? { ...base, elements } : base
  }

  // Apply several position changes as ONE edit (one undo step) — used by
  // group drag so the whole move reverts together.
  function updateElementPositions(moves) {
    if (!config || moves.length === 0) return
    commitConfig(applyMoves(config, moves))
  }

  // Update positions live during a drag without touching undo history.
  // Call commitElementPositions on drop to persist the pre-drag snapshot.
  function moveElementPositionsLive(moves) {
    if (!config || moves.length === 0) return
    config = applyMoves(config, moves)
  }

  // Commit a drag: push the pre-drag snapshot to history so Ctrl+Z reverts
  // the whole drag in one step, then apply the final positions.
  function commitElementPositions(preDragConfigJson, moves) {
    if (!config) return
    if (preDragConfigJson) {
      history = [...history.slice(-(HISTORY_LIMIT - 1)), preDragConfigJson]
      redoStack = []
    }
    if (moves.length === 0) return
    config = applyMoves(config, moves)
  }

  // Live element update without touching undo history — use during an
  // in-progress resize/drag, then call commitElementUpdate on release.
  function updateElementLive(id, updates) {
    const found = findElement(id)
    if (!found) return
    const elements = [...config.elements]
    elements[found.idx] = { ...found.el, ...updates }
    config = { ...config, elements }
  }

  // Commit an arbitrary element update as one undo step.
  function commitElementUpdate(preConfigJson, id, updates) {
    if (!config) return
    if (preConfigJson) {
      history = [...history.slice(-(HISTORY_LIMIT - 1)), preConfigJson]
      redoStack = []
    }
    const found = findElement(id)
    if (!found) return
    const elements = [...config.elements]
    elements[found.idx] = { ...found.el, ...updates }
    config = { ...config, elements }
  }

  // Stable, collision-free id within the config. Keeps the readable
  // `type-N` scheme (matches converted templates / Rust's opaque ids).
  function newElementId(type, elements) {
    const taken = (elements ?? []).map((e) => e.id)
    let n = 0
    let id
    do {
      id = `${type}-${n++}`
    } while (taken.includes(id))
    return id
  }

  function allElementIds(nextConfig = config) {
    return (nextConfig?.elements ?? []).map((e) => e.id)
  }

  function normalizedElementLayerIds(nextConfig = config) {
    const ids = allElementIds(nextConfig)
    const existing = (nextConfig?.scene?.layers ?? []).filter((id) =>
      ids.includes(id),
    )
    const missing = ids.filter((id) => !existing.includes(id))
    return [...existing, ...missing]
  }

  function withNormalizedLayers(nextConfig) {
    if (!nextConfig?.scene) return nextConfig
    return {
      ...nextConfig,
      scene: {
        ...nextConfig.scene,
        layers: normalizedElementLayerIds(nextConfig),
      },
    }
  }

  function addElement(type, defaults) {
    if (!config) return null
    const id = newElementId(type, config.elements ?? [])
    const el = { type, id, ...defaults }
    const next = { ...config, elements: [...(config.elements ?? []), el] }
    const layers = normalizedElementLayerIds(next)
    commitConfig({
      ...next,
      scene: { ...next.scene, layers: [...layers.filter((x) => x !== id), id] },
    })
    return id
  }

  function removeElement(id) {
    if (!config?.elements) return
    const elements = config.elements.filter((e) => e.id !== id)
    const groups = (config.scene?.groups ?? []).map((g) => ({
      ...g,
      element_ids: g.element_ids.filter((eid) => eid !== id),
    }))
    const next = withNormalizedLayers({ ...config, elements })
    commitConfig({ ...next, scene: { ...next.scene, groups } })
    if (selectedElementId === id) selectOnly(null)
  }

  function moveElementLayer(id, delta) {
    if (!config?.scene) return
    const layers = normalizedElementLayerIds()
    const from = layers.indexOf(id)
    if (from < 0) return
    const to = Math.max(0, Math.min(layers.length - 1, from + delta))
    if (to === from) return
    const next = [...layers]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    commitConfig({ ...config, scene: { ...config.scene, layers: next } })
  }

  function setElementLayerOrder(ids) {
    if (!config?.scene) return
    const validIds = normalizedElementLayerIds()
    if (ids.length !== validIds.length) return
    if (!ids.every((id) => validIds.includes(id))) return
    commitConfig({ ...config, scene: { ...config.scene, layers: [...ids] } })
  }

  // ── Group management ──────────────────────────────────────────────────────

  function selectGroup(groupId) {
    const group = (config?.scene?.groups ?? []).find((g) => g.id === groupId)
    if (!group) return
    selectedGroupId = groupId
    selectedElementIds = [...group.element_ids]
    selectedElementId = group.element_ids[0] ?? null
  }

  function newGroupId() {
    const existing = (config?.scene?.groups ?? []).map((g) => g.id)
    let n = 0
    let id
    do {
      id = `group-${n++}`
    } while (existing.includes(id))
    return id
  }

  function createGroup(name, elementIds) {
    if (!config?.scene) return null
    const id = newGroupId()
    const groups = (config.scene.groups ?? [])
      .map((g) => ({
        ...g,
        element_ids: g.element_ids.filter((eid) => !elementIds.includes(eid)),
      }))
      .concat({ id, name, element_ids: [...elementIds] })
    commitConfig({ ...config, scene: { ...config.scene, groups } })
    return id
  }

  function deleteGroup(groupId) {
    if (!config?.scene) return
    const groups = (config.scene.groups ?? []).filter((g) => g.id !== groupId)
    commitConfig({ ...config, scene: { ...config.scene, groups } })
    if (selectedGroupId === groupId) selectOnly(null)
  }

  function renameGroup(groupId, name) {
    if (!config?.scene?.groups) return
    const groups = config.scene.groups.map((g) =>
      g.id === groupId ? { ...g, name } : g,
    )
    commitConfig({ ...config, scene: { ...config.scene, groups } })
  }

  function removeElementFromGroups(elementId) {
    if (!config?.scene?.groups) return
    const groups = config.scene.groups.map((g) => ({
      ...g,
      element_ids: g.element_ids.filter((id) => id !== elementId),
    }))
    commitConfig({ ...config, scene: { ...config.scene, groups } })
  }

  function removeFromGroupAndReorder(elementId, newLayerOrder) {
    if (!config?.scene) return
    const groups = (config.scene.groups ?? []).map((g) => ({
      ...g,
      element_ids: g.element_ids.filter((id) => id !== elementId),
    }))
    const validIds = normalizedElementLayerIds()
    if (
      newLayerOrder.length !== validIds.length ||
      !newLayerOrder.every((id) => validIds.includes(id))
    )
      return
    commitConfig({
      ...config,
      scene: { ...config.scene, groups, layers: newLayerOrder },
    })
  }

  function addElementToGroup(elementId, groupId) {
    if (!config?.scene?.groups) return
    const groups = config.scene.groups.map((g) => {
      if (g.id === groupId) {
        if (g.element_ids.includes(elementId)) return g
        return { ...g, element_ids: [...g.element_ids, elementId] }
      }
      return {
        ...g,
        element_ids: g.element_ids.filter((id) => id !== elementId),
      }
    })
    commitConfig({ ...config, scene: { ...config.scene, groups } })
  }

  function parseSelectedElement() {
    if (!selectedElementId || !config) return null
    const found = findElement(selectedElementId)
    return found
      ? { id: found.el.id, item: found.el, type: found.el.type }
      : null
  }

  function selectedElementLabel() {
    const s = parseSelectedElement()
    if (!s) return null
    const name = elementTypeName(s.item)
    const text = s.item.text || s.item.value || ''
    return text ? `${name} "${text}"` : name
  }

  function deleteSelectedElement() {
    const s = parseSelectedElement()
    if (s) removeElement(s.id)
  }

  function copyElement() {
    const s = parseSelectedElement()
    if (!s) return
    copiedElement = s.item
  }

  function pasteElement() {
    if (!copiedElement) return
    const rest = { ...copiedElement }
    const type = rest.type
    delete rest.id
    delete rest.type
    addElement(type, {
      ...rest,
      x: (rest.x ?? 0) + 20,
      y: (rest.y ?? 0) + 20,
    })
  }

  // ── Template actions ─────────────────────────────────────────────────────

  function toFilename(raw) {
    const stem = raw
      .trim()
      .toLowerCase()
      .replace(/\.json$/, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    return stem ? `${stem}.json` : null
  }

  function templateDisplayName(filename) {
    return filename
      .replace(/\.json$/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }

  function blankTemplate(name) {
    return {
      scene: {
        width: outputWidth,
        height: outputHeight,
        fps: 30,
        start: 0,
        end: Math.max(1, Math.floor(activityDuration || 60)),
        color: '#ffffff',
        opacity: 1,
        font_size: 64,
        overlay_filename: name.replace(/\.json$/, ''),
        layers: [],
      },
      elements: [],
    }
  }

  function showSuccess(msg) {
    successMessage = msg
    clearTimeout(successTimer)
    successTimer = setTimeout(() => {
      successMessage = null
    }, 2500)
  }

  async function saveTemplate() {
    if (!config) return
    let filename = loadedTemplateFilename
    const tpl = templates.find((t) => t.id === filename)
    if (!filename || tpl?.type === 'built-in') {
      const name = prompt(
        'Template name:',
        filename?.replace('.json', '') ?? 'my_overlay',
      )
      if (!name) return
      filename = toFilename(name)
      if (!filename) return
    }
    await backend.saveTemplate(filename, config)
    loadedTemplateFilename = filename
    markPristine()
    if (currentPreviewImage) {
      backend.saveTemplatePreview(filename, currentPreviewImage).catch(() => {})
    }
    await fetchTemplates()
    showSuccess(`Saved "${filename}"`)
  }

  async function saveTemplateAs() {
    if (!config) return
    const name = prompt(
      'Save as:',
      loadedTemplateFilename?.replace('.json', '') ?? 'my_overlay',
    )
    if (!name) return
    const filename = toFilename(name)
    if (!filename) return
    await backend.saveTemplate(filename, config)
    loadedTemplateFilename = filename
    markPristine()
    if (currentPreviewImage) {
      backend.saveTemplatePreview(filename, currentPreviewImage).catch(() => {})
    }
    await fetchTemplates()
    showSuccess(`Saved "${filename}"`)
  }

  async function newTemplate(name) {
    if (!name) return
    const filename = toFilename(name)
    if (!filename) return
    const base = blankTemplate(filename)
    await backend.saveTemplate(filename, base)
    config = base
    loadedTemplateFilename = filename
    selectOnly(null)
    resetHistory()
    markPristine()
    await fetchTemplates()
    showSuccess(`Created "${templateDisplayName(filename)}"`)
  }

  async function renameTemplate(nextName = null) {
    if (!loadedTemplateFilename) {
      errorMessage = 'Load or create a template before renaming it.'
      return
    }
    const current = loadedTemplateFilename.replace(/\.json$/, '')
    const name = nextName ?? prompt('Rename template:', current)
    if (!name) return
    const filename = toFilename(name)
    if (!filename || filename === loadedTemplateFilename) return
    try {
      await backend.renameTemplate(loadedTemplateFilename, filename)
    } catch (e) {
      const message = e?.message ?? String(e)
      if (!message.includes('Template not found')) throw e
      if (!config) throw e
      await backend.saveTemplate(filename, config)
      markPristine()
    }
    loadedTemplateFilename = filename
    await fetchTemplates()
    showSuccess(`Renamed to "${templateDisplayName(filename)}"`)
  }

  async function fetchTemplates() {
    try {
      templates = await backend.listTemplates()
    } catch (err) {
      console.error('Failed to fetch templates:', err)
    }
  }

  async function fetchFonts() {
    try {
      fonts = await backend.listFonts()
    } catch (err) {
      console.error('Failed to fetch fonts:', err)
    }
  }

  // Pick a .ttf/.otf, copy it into the user fonts dir, refresh the list, and
  // return the new font's filename so the caller can select it.
  async function addCustomFont() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Fonts', extensions: ['ttf', 'otf'] }],
    })
    if (!selected) return null
    try {
      fonts = await backend.importFont(selected)
      return selected.split(/[\\/]/).pop()
    } catch (err) {
      errorMessage = `Could not add font: ${err?.message ?? err}`
      return null
    }
  }

  async function runBenchmark() {
    if (renderingVideo || benchmarking || !config || !gpxFilename) return
    benchmarking = true
    try {
      const result = await backend.nativeBenchmark(
        config,
        gpxFilename,
        90,
        outputWidth,
        outputHeight,
      )
      if (result.frames > 0 && result.elapsed_ms > 0) {
        const fps = (result.frames / result.elapsed_ms) * 1000
        lastRenderFps = fps
        localStorage.setItem('lastRenderFps', fps.toFixed(4))
      }
    } catch (e) {
      console.debug('Benchmark failed:', e)
    } finally {
      benchmarking = false
    }
  }

  // Re-benchmark whenever the template or GPX changes (debounced so rapid
  // config edits don't flood the Rust thread pool).
  $effect(() => {
    void loadedTemplateFilename
    void gpxFilename
    void outputWidth
    void outputHeight
    if (!config || !gpxFilename) return
    const timer = setTimeout(runBenchmark, 800)
    return () => clearTimeout(timer)
  })

  async function loadTemplate(filename) {
    const data = await backend.getTemplate(filename)
    config = data
    loadedTemplateFilename = filename
    selectOnly(null)
    resetHistory()
    markPristine()
  }

  return {
    get config() {
      return config
    },
    set config(v) {
      config = v
      resetHistory()
    },
    get gpxFilename() {
      return gpxFilename
    },
    set gpxFilename(v) {
      gpxFilename = v
    },
    get activityDuration() {
      return activityDuration
    },
    set activityDuration(v) {
      activityDuration = v
    },
    get selectedSecond() {
      return selectedSecond
    },
    set selectedSecond(v) {
      selectedSecond = v
    },
    get isTemplateModified() {
      return templateModified()
    },
    get pendingDiscard() {
      return pendingDiscard
    },
    confirmIfModified,
    resolvePendingDiscard,
    fetchDefaultOutputDir,
    get loadedTemplateFilename() {
      return loadedTemplateFilename
    },
    set loadedTemplateFilename(v) {
      loadedTemplateFilename = v
    },
    get outputDir() {
      return outputDir
    },
    set outputDir(v) {
      outputDir = v
    },
    get defaultOutputDir() {
      return defaultOutputDir
    },
    get outputWidth() {
      return outputWidth
    },
    set outputWidth(v) {
      outputWidth = v
    },
    get outputHeight() {
      return outputHeight
    },
    set outputHeight(v) {
      outputHeight = v
    },
    get previewFps() {
      return previewFps
    },
    set previewFps(v) {
      previewFps = v
    },
    get currentPreviewImage() {
      return currentPreviewImage
    },
    set currentPreviewImage(v) {
      currentPreviewImage = v
    },
    get renderingVideo() {
      return renderingVideo
    },
    set renderingVideo(v) {
      renderingVideo = v
    },
    get errorMessage() {
      return errorMessage
    },
    set errorMessage(v) {
      errorMessage = v
    },
    get successMessage() {
      return successMessage
    },
    get templates() {
      return templates
    },
    set templates(v) {
      templates = v
    },
    get fonts() {
      return fonts
    },
    fetchFonts,
    addCustomFont,
    get showTemplatePicker() {
      return showTemplatePicker
    },
    set showTemplatePicker(v) {
      showTemplatePicker = v
    },
    get selectedElementId() {
      return selectedElementId
    },
    set selectedElementId(v) {
      selectOnly(v)
    },
    get selectedElementIds() {
      return selectedElementIds
    },
    toggleElementSelection,
    setSelectedElements,
    get selectedGroupId() {
      return selectedGroupId
    },
    selectGroup,
    createGroup,
    deleteGroup,
    renameGroup,
    removeElementFromGroups,
    removeFromGroupAndReorder,
    addElementToGroup,
    get canUndo() {
      return history.length > 0
    },
    get canRedo() {
      return redoStack.length > 0
    },
    undo,
    redo,
    get elementLayerOrder() {
      return normalizedElementLayerIds()
    },
    moveElementLayer,
    setElementLayerOrder,
    get renderProgress() {
      return renderProgress
    },
    set renderProgress(v) {
      renderProgress = v
    },
    clearError() {
      errorMessage = null
    },
    updateScene,
    updateElement,
    updateElementPos,
    updateElementPositions,
    moveElementPositionsLive,
    commitElementPositions,
    updateElementLive,
    commitElementUpdate,
    addElement,
    removeElement,
    deleteSelectedElement,
    get copiedElement() {
      return copiedElement
    },
    copyElement,
    pasteElement,
    get lastRenderFps() {
      return lastRenderFps
    },
    set lastRenderFps(v) {
      lastRenderFps = v
    },
    get benchmarking() {
      return benchmarking
    },
    selectedElementLabel,
    fetchTemplates,
    loadTemplate,
    saveTemplate,
    saveTemplateAs,
    newTemplate,
    renameTemplate,
  }
}
