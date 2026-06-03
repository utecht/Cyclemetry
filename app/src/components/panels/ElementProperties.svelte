<script>
  /**
   * Right panel: property editor for the currently selected element.
   * All changes write directly into app.config via app.updateElement().
   */
  import { getContext } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import { AlertTriangle, Folder, FolderOpen, Lock, LockOpen, Ungroup } from 'lucide-svelte'
  import Input from '../ui/Input.svelte'
  import OpacityControl from '../ui/OpacityControl.svelte'
  import Select from '../ui/Select.svelte'
  import Switch from '../ui/Switch.svelte'
  import Tooltip from '../ui/Tooltip.svelte'
  import ColorInput from '../ui/ColorInput.svelte'
  import AssetPicker from '../overlays/AssetPicker.svelte'
  import * as backend from '../../api/backend.js'
  import { elementTypeName } from '../../lib/elementTypes.js'
  import { metricRangeIssues, metricValueIssue } from '../../lib/metricLimits.js'
  import { normalizeElementField, normalizeTemplateIntegerField } from '../../lib/templateSchema.js'

  const app = getContext('app')

  // Single source of truth: app.fonts (bundled, user-installed, and system).
  // Importing new fonts lives in the Templates menu (Add Custom Font…).
  const fontGroup = (font) => (font.source === 'system' ? 'System fonts' : 'Font files')

  function fontOpts(includeSceneDefault) {
    return [
      ...(includeSceneDefault ? [{ value: '', label: 'Scene default' }] : []),
      ...app.fonts.map((font) => ({ value: font.value, label: font.label, group: fontGroup(font) })),
    ]
  }
  const METRICS = ['speed', 'heartrate', 'power', 'elevation', 'cadence', 'gradient', 'temperature', 'gear', 'front_gear', 'rear_gear', 'time', 'distance']
  const PLOT_METRICS = ['elevation', 'speed', 'heartrate', 'power', 'cadence', 'gradient', 'temperature', 'front_gear', 'rear_gear', 'course', 'distance']
  const METER_METRICS = ['speed', 'heartrate', 'power', 'elevation', 'cadence', 'gradient', 'temperature', 'front_gear', 'rear_gear']
  const METER_DIRECTIONS = [
    { value: 'up', label: 'Fill upward' },
    { value: 'down', label: 'Fill downward' },
    { value: 'right', label: 'Fill rightward' },
    { value: 'left', label: 'Fill leftward' },
  ]
  const COURSE_MARKER_STYLES = [
    { value: 'checkered', label: 'Checkered finish' },
    { value: 'circle', label: 'Colored circle' },
    { value: 'rectangle', label: 'Colored rectangle' },
  ]
  const DISTANCE_REFERENCES = [
    { value: 'overlay_start', label: 'Since overlay start' },
    { value: 'activity_start', label: 'Since activity start' },
    { value: 'overlay_end', label: 'Until overlay end' },
    { value: 'activity_end', label: 'Until activity end' },
    { value: 'until_custom', label: 'Until custom point' },
    { value: 'since_custom', label: 'Since custom point' },
  ]
  // Per-metric explicit unit options. Metrics absent from this map (gradient,
  // power, cadence, heartrate, time) have no unit choice and render raw.
  // Legacy 'metric'/'imperial' tokens still render — the Rust side normalizes
  // them — but new selections use these precise tokens.
  const UNITS_BY_METRIC = {
    distance: [
      { value: 'km', label: 'Kilometers (km)' },
      { value: 'm', label: 'Meters (m)' },
      { value: 'mi', label: 'Miles (mi)' },
    ],
    speed: [
      { value: 'kmh', label: 'km/h' },
      { value: 'mph', label: 'mph' },
      { value: 'ms', label: 'm/s' },
    ],
    elevation: [
      { value: 'm', label: 'Meters (m)' },
      { value: 'ft', label: 'Feet (ft)' },
    ],
    temperature: [
      { value: 'c', label: 'Celsius (°C)' },
      { value: 'f', label: 'Fahrenheit (°F)' },
    ],
  }
  // Default unit token per metric, used when the element has none set yet
  // (matches the Rust-side default so the picker reflects what renders).
  const DEFAULT_UNIT = { distance: 'km', speed: 'kmh', elevation: 'm', temperature: 'c' }
  const markerId = () => `marker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  // Resolve the unit token to show in the picker, mapping legacy
  // metric/imperial (or unset) to the matching precise token.
  function displayUnit(metric, unit) {
    const opts = UNITS_BY_METRIC[metric] ?? []
    if (opts.some((o) => o.value === unit)) return unit
    if (unit === 'imperial') return { distance: 'mi', speed: 'mph', elevation: 'ft', temperature: 'f' }[metric]
    return DEFAULT_UNIT[metric]
  }

  let selected = $derived(() => {
    const id = app.selectedElementId
    if (!id || !app.config?.elements) return null
    const item = app.config.elements.find((e) => e.id === id)
    return item ? { id, item, type: item.type } : null
  })

  // Scene color variables — passed to every ColorInput so vars can be selected
  const sceneVars = $derived(app.config?.scene?.vars ?? {})

  function update(field, raw) {
    const s = selected()
    if (!s) return
    const numFields = ['x', 'y', 'width', 'height', 'font_size', 'letter_spacing', 'opacity', 'fill_opacity', 'decimal_rounding', 'rotation', 'distance_target', 'radius', 'start_angle', 'sweep_angle', 'arc_width', 'needle_width', 'cap_radius', 'segments', 'gap', 'background_opacity', 'background_margin', 'border_width', 'border_opacity', 'scale_font_size', 'scale_offset', 'scale_tick_length', 'scale_tick_width', 'scale_ticks', 'pulse_bpm', 'pulse_amplitude']
    const rangeBoundFields = ['min', 'max']
    let value = rangeBoundFields.includes(field)
      ? parseRangeBound(raw)
      : numFields.includes(field) ? (raw === '' ? undefined : Number(raw)) : raw
    value = normalizeElementField(field, value)
    app.updateElement(s.id, { [field]: value })
  }

  function parseRangeBound(raw) {
    const trimmed = String(raw ?? '').trim().toLowerCase()
    if (trimmed === '') return undefined
    if (trimmed === 'min' || trimmed === 'max') return trimmed
    const value = Number(trimmed)
    return Number.isFinite(value) ? value : undefined
  }

  const rangeCache = new SvelteMap()

  function metricRangeUnit(item) {
    if (!item?.value) return null
    return UNITS_BY_METRIC[item.value] ? displayUnit(item.value, item.unit) : item.unit
  }

  function rangeContext() {
    if (!app.hasActivity || !app.gpxFilename || !app.config?.scene) return null
    return {
      gpx: app.gpxFilename,
      start: app.config.scene.start ?? 0,
      end: app.config.scene.end ?? app.timelineDuration,
    }
  }

  function rangeKey(metric, unit, context = rangeContext()) {
    if (!context || !metric) return null
    return JSON.stringify([context.gpx, metric, unit ?? null, context.start, context.end])
  }

  function loadRange(metric, unit, context = rangeContext()) {
    const key = rangeKey(metric, unit, context)
    if (!key) return
    const current = rangeCache.get(key)
    if (current?.status === 'loading' || current?.status === 'ready') return

    rangeCache.set(key, { status: 'loading' })
    backend.getActivityMetricRange(context.gpx, metric, unit, context.start, context.end)
      .then((range) => {
        rangeCache.set(key, { status: 'ready', range })
      })
      .catch((err) => {
        rangeCache.set(key, {
          status: 'error',
          error: err?.message ?? String(err),
        })
      })
  }

  function formatRangeValue(value) {
    if (!Number.isFinite(value)) return 'unavailable'
    const abs = Math.abs(value)
    if (abs >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
    if (abs >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    if (abs >= 10) return value.toLocaleString(undefined, { maximumFractionDigits: 3 })
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }

  function rangeBoundTooltip(item, field) {
    const bound = item?.[field]
    if (bound !== 'min' && bound !== 'max') return ''
    if (!app.hasActivity) return 'Load an activity'
    const entry = rangeCache.get(rangeKey(item.value, metricRangeUnit(item)))
    if (entry?.status === 'ready') {
      const value = entry.range?.[bound]
      const issue = metricValueIssue(item.value, metricRangeUnit(item), value)
      if (issue) {
        return `${formatRangeValue(value)}
Looks unrealistic for ${item.value} (expected ${issue.expected}). Enter a manual ${field}.`
      }
      return formatRangeValue(value)
    }
    if (entry?.status === 'error') return entry.error
    return 'Computing...'
  }

  function rangeWarning(item) {
    if (!item) return null
    const entry = rangeCache.get(rangeKey(item.value, metricRangeUnit(item)))
    if (entry?.status !== 'ready') return null
    const issues = metricRangeIssues(item.value, metricRangeUnit(item), entry.range)
    const fields = ['min', 'max']
    const field = fields.find((f) => {
      const bound = item[f]
      return (bound === 'min' || bound === 'max') && issues[bound]
    })
    const issue = field ? issues[item[field]] : null
    if (!issue) return null
    return `Computed ${field} ${formatRangeValue(issue.value)} looks unrealistic for ${item.value}. Enter a manual ${field}.`
  }

  $effect(() => {
    const context = rangeContext()
    if (!context) return

    for (const metric of METER_METRICS) {
      loadRange(metric, metricRangeUnit({ value: metric }), context)
    }

    const s = selected()
    const item = s?.item
    if (s?.type === 'meter' || s?.type === 'gauge') {
      loadRange(item?.value, metricRangeUnit(item), context)
    }
  })

  // Switch the distance unit, converting distance_target to the equivalent
  // value in the new unit so the on-screen target stays the same real distance.
  function changeDistanceUnit(newUnit) {
    const s = selected()
    if (!s) return
    const oldUnit = displayUnit('distance', s.item.unit)
    const updates = { unit: newUnit }
    const t = s.item.distance_target
    if (oldUnit !== newUnit && t != null && t !== '' && !Number.isNaN(Number(t))) {
      const toM = (v, u) => (u === 'm' ? v : u === 'mi' ? v * 1609.34 : v * 1000)
      const fromM = (m, u) => (u === 'm' ? m : u === 'mi' ? m / 1609.34 : m / 1000)
      const meters = toM(Number(t), oldUnit)
      const conv = fromM(meters, newUnit)
      updates.distance_target =
        newUnit === 'm' ? Math.round(conv) : Math.round(conv * 100) / 100
    }
    app.updateElement(s.id, updates)
  }

  // Update a nested object field: updateNested('line', 'color', '#fff')
  function updateNested(obj, field, raw) {
    const s = selected()
    if (!s) return
    const numFields = ['width', 'opacity', 'past_opacity', 'future_opacity']
    const value = numFields.includes(field) ? (raw === '' ? undefined : Number(raw)) : raw
    const current = s.item[obj] ?? {}
    app.updateElement(s.id, { [obj]: { ...current, [field]: value } })
  }

  // Update point — the single tracking marker. Creates it if absent.
  function updatePoint(field, raw) {
    const s = selected()
    if (!s) return
    const numFields = ['weight', 'opacity', 'edge_width']
    const value = numFields.includes(field) ? (raw === '' ? undefined : Number(raw)) : raw
    const current = s.item.point ?? {}
    app.updateElement(s.id, { point: { ...current, [field]: value } })
  }

  function courseMarkers() {
    return selected()?.item.markers ?? []
  }

  function selectedCourseMarker() {
    const markers = courseMarkers()
    if (markers.length === 0) return null
    return markers.find((m) => m.id === app.selectedCourseMarkerId) ?? markers[0]
  }

  function setCourseMarkers(markers) {
    const s = selected()
    if (!s) return
    app.updateElement(s.id, { markers: markers.length ? markers : undefined })
  }

  async function defaultCourseMarkerDistance(markers) {
    if (markers.length > 0) return markers[markers.length - 1]?.distance ?? 0
    if (!app.hasActivity) return 0
    try {
      const start = app.config?.scene?.start ?? 0
      const end = app.config?.scene?.end ?? app.timelineDuration
      const info = await backend.getActivityDistanceInfo(app.gpxFilename, start, end)
      return info.overlay_end_m ?? info.total_m ?? 0
    } catch {
      return 0
    }
  }

  async function addCourseMarker() {
    const markers = courseMarkers()
    const id = markerId()
    const distance = await defaultCourseMarkerDistance(markers)
    setCourseMarkers([
      ...markers,
      {
        id,
        name: markers.length === 0 ? 'Finish' : `Marker ${markers.length + 1}`,
        style: 'checkered',
        color: '#ef4444',
        distance,
        width: 34,
        height: 10,
        rotation: 0,
        opacity: 1,
      },
    ])
    app.selectedCourseMarkerId = id
  }

  function updateCourseMarker(field, raw) {
    const marker = selectedCourseMarker()
    if (!marker) return
    const numFields = ['distance', 'width', 'height', 'rotation', 'opacity']
    const value = numFields.includes(field) ? (raw === '' ? undefined : Number(raw)) : raw
    setCourseMarkers(courseMarkers().map((m) => (
      m === marker || (marker.id && m.id === marker.id) ? { ...m, [field]: value } : m
    )))
  }

  function removeCourseMarker(id) {
    const marker = selectedCourseMarker()
    const next = courseMarkers().filter((m) => (
      marker ? !(m === marker || (id && m.id === id)) : m.id !== id
    ))
    setCourseMarkers(next)
    app.selectedCourseMarkerId = next[0]?.id ?? null
  }

  // Point label (value text next to the chart marker, e.g. "960 M").
  const POINT_LABEL_DEFAULT = {
    font: 'Furore.otf',
    font_size: 64,
    italic: false,
    color: '#ffffffc8',
    x_offset: 30,
    y_offset: 30,
    units: ['metric', 'imperial'],
    decimal_rounding: 0,
  }

  function togglePointLabel(enabled) {
    const s = selected()
    if (!s) return
    app.updateElement(s.id, {
      point_label: enabled ? { ...POINT_LABEL_DEFAULT } : undefined,
    })
  }

  function updatePL(field, raw) {
    const s = selected()
    if (!s) return
    const numFields = ['font_size', 'x_offset', 'y_offset', 'decimal_rounding']
    let value = numFields.includes(field)
      ? raw === ''
        ? undefined
        : Number(raw)
      : raw
    value = normalizeTemplateIntegerField(field, value)
    const current = s.item.point_label ?? {}
    app.updateElement(s.id, {
      point_label: { ...current, [field]: value },
    })
  }

  // units is an ordered array; keep metric before imperial.
  function toggleUnit(unit, on) {
    const s = selected()
    if (!s) return
    const cur = s.item.point_label?.units ?? []
    const next = on ? [...cur, unit] : cur.filter((u) => u !== unit)
    const units = ['metric', 'imperial'].filter((u) => next.includes(u))
    const current = s.item.point_label ?? {}
    app.updateElement(s.id, {
      point_label: { ...current, units },
    })
  }

  function numVal(item, field) {
    return item[field] ?? ''
  }

  function numericBound(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  function updateImageSize(field, raw) {
    const s = selected()
    if (!s || s.type !== 'image') return
    const val = raw === '' ? undefined : Number(raw)
    if (!val || val <= 0) { app.updateElement(s.id, { [field]: val }); return }
    const nw = s.item.natural_width ?? s.item.width ?? 200
    const nh = s.item.natural_height ?? s.item.height ?? 200
    const ratio = nw / nh
    if (field === 'width') {
      app.updateElement(s.id, { width: Math.round(val), height: Math.round(val / ratio) })
    } else {
      app.updateElement(s.id, { width: Math.round(val * ratio), height: Math.round(val) })
    }
  }

  async function applyAsset(name) {
    const s = selected()
    if (!s) return
    const updates = { file: name }
    try {
      const size = await backend.imageSize(name)
      const width = s.item.width ?? size.width
      updates.width = Math.round(width)
      updates.height = Math.round(width * (size.height / size.width))
      updates.natural_width = size.width
      updates.natural_height = size.height
    } catch { /* fallback: keep existing dimensions */ }
    app.updateElement(s.id, updates)
  }

  // Color row helper — returns [colorValue, hexDisplay]
  function colorRow(obj, field, fallback = '#ffffff') {
    const s = selected()
    return s?.item[obj]?.[field] ?? fallback
  }

  // The element's representative color, shown by the single basic-mode swatch.
  function primaryColor() {
    const s = selected()
    if (!s) return '#ffffff'
    const it = s.item
    return (
      it.color ??
      it.line?.color ??
      it.point?.color ??
      '#ffffff'
    )
  }

  // Basic mode: one color drives every color on the element. Applied as a
  // single updateElement call so it's one undo step.
  function setAllColors(raw) {
    const s = selected()
    if (!s) return
    if (s.type === 'plot') {
      const it = s.item
      const patch = {
        color: raw,
        line: { ...(it.line ?? {}), color: raw },
        fill: { ...(it.fill ?? {}), color: raw },
      }
      if (it.point) patch.point = { ...it.point, color: raw }
      if (it.point_label) patch.point_label = { ...it.point_label, color: raw }
      app.updateElement(s.id, patch)
    } else {
      app.updateElement(s.id, { color: raw })
    }
  }

  // Meter gradient stops (ordered min→max). Absent = solid `color`.
  function meterGradient() {
    return selected()?.item.gradient ?? []
  }
  function setGradient(stops) {
    const s = selected()
    if (!s) return
    app.updateElement(s.id, { gradient: stops.length ? stops : undefined })
  }
  function updateGradientStop(i, val) {
    const stops = [...meterGradient()]
    stops[i] = val
    setGradient(stops)
  }
  function addGradientStop() {
    const stops = meterGradient()
    setGradient([...stops, stops[stops.length - 1] ?? '#ffffff'])
  }
  function removeGradientStop(i) {
    setGradient(meterGradient().filter((_, idx) => idx !== i))
  }

  // Continuous fill gradient: stops[0] = low-value color, stops[1] = high-value color.
  // Initialises both stops from the current solid color when the array is empty.
  function updateContinuousGradientStop(idx, val) {
    const cur = meterGradient()
    const base = selected()?.item.color ?? '#ffffff'
    const stops = cur.length >= 2 ? [...cur] : [base, base]
    stops[idx] = val
    setGradient(stops.slice(0, 2))
  }

  // Scale labels: null = disabled, [] = auto (min/mid/max), [v,...] = explicit values.
  function scaleLabels() { return selected()?.item.scale_labels ?? null }
  function scaleEnabled() { return scaleLabels() !== null && scaleLabels() !== undefined }
  function enableScale() {
    const s = selected(); if (!s) return
    app.updateElement(s.id, { scale_labels: [] })
  }
  function disableScale() {
    const s = selected(); if (!s) return
    app.updateElement(s.id, { scale_labels: undefined })
  }
  function addScaleLabel() {
    const s = selected(); if (!s) return
    const cur = scaleLabels() ?? []
    const min = numericBound(s.item.min, 0)
    const max = numericBound(s.item.max, 1)
    const mid = (min + max) / 2
    app.updateElement(s.id, { scale_labels: [...cur, cur.length === 0 ? min : mid] })
  }
  function updateScaleLabel(i, raw) {
    const s = selected(); if (!s) return
    const cur = [...(scaleLabels() ?? [])]
    cur[i] = raw === '' ? 0 : Number(raw)
    app.updateElement(s.id, { scale_labels: cur })
  }
  function removeScaleLabel(i) {
    const s = selected(); if (!s) return
    app.updateElement(s.id, { scale_labels: (scaleLabels() ?? []).filter((_, idx) => idx !== i) })
  }

  // Progressive disclosure: most overlays reuse the same colors/fonts/line
  // weights, so detailed/structural controls hide behind "Advanced".
  let showAdvanced = $state(false)
  let showAssetPicker = $state(false)

  function applyMeterActivityRange() {
    const s = selected()
    if (!s || s.type !== 'meter') return
    app.updateElement(s.id, { min: 'min', max: 'max' })
  }

  function applyGaugeActivityRange() {
    const s = selected()
    if (!s || s.type !== 'gauge') return
    app.updateElement(s.id, { min: 'min', max: 'max' })
  }
</script>

<div class="h-full overflow-y-auto px-4 py-3">
  {#if app.selectedGroupId}
    {@const group = (app.config?.scene?.groups ?? []).find((g) => g.id === app.selectedGroupId)}
    {#if group}
      <div class="mb-3 flex items-center gap-2">
        <Folder size={13} class="shrink-0 text-zinc-400" />
        <p class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Group</p>
      </div>
      <div class="space-y-3">
        <div>
          <label for="group-name" class="block text-[10px] text-zinc-500 mb-1">Name</label>
          <input
            id="group-name"
            class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-primary transition-colors"
            value={group.name}
            onchange={(e) => app.renameGroup(group.id, e.currentTarget.value)}
          />
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-zinc-500">{group.element_ids.length} element{group.element_ids.length !== 1 ? 's' : ''}</span>
          <button
            onclick={() => app.deleteGroup(group.id)}
            class="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-zinc-400 hover:text-destructive hover:bg-zinc-800 transition-colors"
            title="Ungroup (elements remain)"
          >
            <Ungroup size={12} />
            Ungroup
          </button>
        </div>
        <p class="text-[10px] text-zinc-600 italic">Drag any element in this group on the canvas to move them all together.</p>
      </div>
    {/if}
  {:else if !selected()}
    <div class="flex h-full items-center justify-center">
      <p class="text-xs text-zinc-600 italic text-center">Click an element on the canvas<br>or in the list to edit it.</p>
    </div>
  {:else}
    {@const { id, item, type } = selected()}

    <div class="mb-3">
      <p class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {elementTypeName(item)}
      </p>
    </div>

    <!-- Advanced disclosure: hides position/size and rarely-changed detail -->
    <div class="mb-4 flex items-center justify-between">
      <span class="text-[10px] uppercase tracking-wider text-zinc-600">Advanced</span>
      <Switch
        checked={showAdvanced}
        ariaLabel="Advanced options"
        onchange={(checked) => (showAdvanced = checked)}
      />
    </div>

    <!-- Position (basic) -->
    <section class="mb-4 space-y-2">
      <div class="flex items-center justify-between">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Position</p>
        <button
          onclick={() => app.updateElement(id, { locked: !item.locked })}
          title={item.locked ? 'Unlock position' : 'Lock position'}
          class="p-1 rounded transition-colors {item.locked ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-600 hover:text-zinc-300'}"
        >
          {#if item.locked}
            <Lock size={13} />
          {:else}
            <LockOpen size={13} />
          {/if}
        </button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <label class="space-y-1">
          <span class="text-xs text-zinc-500">X</span>
          <Input type="number" step="1" value={numVal(item, 'x')} oninput={(e) => update('x', e.target.value)} />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-zinc-500">Y</span>
          <Input type="number" step="1" value={numVal(item, 'y')} oninput={(e) => update('y', e.target.value)} />
        </label>
      </div>
    </section>

    <!-- Size — always shown for rect/image; advanced for plot/meter/gauge -->
    {#if type === 'rect' || type === 'image' || (showAdvanced && (type === 'plot' || type === 'meter' || type === 'gauge'))}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Size</p>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Width</span>
            <Input type="number" step="1" value={numVal(item, 'width')} oninput={(e) => type === 'image' ? updateImageSize('width', e.target.value) : update('width', e.target.value)} />
          </label>
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Height</span>
            <Input type="number" step="1" value={numVal(item, 'height')} oninput={(e) => type === 'image' ? updateImageSize('height', e.target.value) : update('height', e.target.value)} />
          </label>
        </div>
        {#if type === 'plot' || type === 'meter' || type === 'gauge'}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Rotation (°)</span>
          <Input type="number" value={item.rotation ?? 0} min={-180} max={180} step={1}
            oninput={(e) => update('rotation', e.target.value)} />
        </label>
        {/if}
        {#if type === 'image' && showAdvanced}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Rotation (°)</span>
          <Input type="number" value={item.rotation ?? 0} min={-180} max={180} step={1}
            oninput={(e) => update('rotation', e.target.value)} />
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Opacity (0–1)</span>
          <OpacityControl value={item.opacity ?? 1}
            oninput={(e) => update('opacity', e.target.value)} />
        </label>
        {/if}
        {#if type === 'rect' && showAdvanced}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Rotation (°)</span>
          <Input type="number" value={item.rotation ?? 0} min={-180} max={180} step={1}
            oninput={(e) => update('rotation', e.target.value)} />
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Corner radius (px)</span>
          <Input type="number" value={item.radius ?? 0} min={0} step={1}
            oninput={(e) => update('radius', e.target.value)} />
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Element opacity (0–1)</span>
          <OpacityControl value={item.opacity ?? 1}
            oninput={(e) => update('opacity', e.target.value)} />
        </label>
        {/if}
      </section>
    {/if}

    <!-- Rectangle fill + border -->
    {#if type === 'rect'}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Fill</p>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Color</span>
          <ColorInput
            value={item.color ?? '#ffffff'}
            vars={sceneVars}
            onchange={(v) => update('color', v)}
          />
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Opacity (0–1)</span>
          <OpacityControl value={item.fill_opacity ?? item.opacity ?? 1}
            oninput={(e) => update('fill_opacity', e.target.value)} />
        </label>
      </section>

      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Border</p>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Color</span>
          <ColorInput
            value={item.border_color ?? ''}
            vars={sceneVars}
            placeholder="none"
            onchange={(v) => update('border_color', v || undefined)}
          />
        </label>
        {#if item.border_color}
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Width (px)</span>
            <Input type="number" value={item.border_width ?? 2} min={0.5} step={0.5}
              oninput={(e) => update('border_width', e.target.value)} />
          </label>
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Opacity (0–1)</span>
            <OpacityControl value={item.border_opacity ?? item.opacity ?? 1}
              oninput={(e) => update('border_opacity', e.target.value)} />
          </label>
        </div>
        {/if}
      </section>
    {/if}

    <!-- Image asset file -->
    {#if type === 'image'}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Asset</p>
        <div class="flex items-center gap-2">
          <span class="flex-1 truncate text-xs font-mono {item.file ? 'text-zinc-300' : 'text-zinc-600 italic'}">
            {item.file || 'None selected'}
          </span>
          <button
            onclick={() => (showAssetPicker = true)}
            class="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-xs font-medium
                   border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
          >
            <FolderOpen size={11} />
            Browse
          </button>
        </div>
      </section>

      {#if showAdvanced}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Pulse animation</p>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">BPM source</span>
          <Select
            value={item.pulse_metric ?? ''}
            options={[{value:'',label:'Fixed BPM'},{value:'heartrate',label:'Heart rate (live)'}]}
            onchange={(v) => update('pulse_metric', v || undefined)}
          />
        </label>
        {#if !item.pulse_metric}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">BPM</span>
          <Input type="number" value={numVal(item, 'pulse_bpm')} min={0} max={300} step={1}
            placeholder="0 = off"
            oninput={(e) => update('pulse_bpm', e.target.value || undefined)} />
        </label>
        {/if}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Amplitude (0–1)</span>
          <Input type="number" value={item.pulse_amplitude ?? 0.15} min={0} max={1} step={0.05}
            oninput={(e) => update('pulse_amplitude', e.target.value)} />
        </label>
      </section>
      {/if}
    {/if}

    {#if showAssetPicker}
      <AssetPicker
        current={selected()?.item.file ?? ''}
        onselect={(name) => { applyAsset(name); showAssetPicker = false }}
        oncancel={() => (showAssetPicker = false)}
      />
    {/if}

    <!-- Text content (label) -->
    {#if type === 'label'}
      <section class="mb-4 space-y-1">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Text</p>
        <Input value={item.text ?? ''} oninput={(e) => update('text', e.target.value)} />
      </section>
    {/if}

    <!-- Metric (value) -->
    {#if type === 'value'}
      <section class="mb-4 space-y-1">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Metric</p>
        <Select
          value={item.value ?? ''}
          options={METRICS.map((m) => ({ value: m, label: m }))}
          onchange={(v) => update('value', v)}
        />
      </section>
    {/if}

    <!-- Metric or chart value -->
    {#if type === 'plot'}
      <section class="mb-4 space-y-1">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Metric</p>
        <Select
          value={item.value ?? ''}
          options={PLOT_METRICS.map((m) => ({ value: m, label: m === 'course' ? 'course (map)' : m }))}
          onchange={(v) => update('value', v)}
        />
      </section>
    {/if}

    <!-- Meter: metric + range + direction -->
    {#if type === 'meter'}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Metric</p>
        <Select
          value={item.value ?? ''}
          options={METER_METRICS.map((m) => ({ value: m, label: m }))}
          onchange={(v) => update('value', v)}
        />
        {#if UNITS_BY_METRIC[item.value]}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Unit</span>
          <Select value={displayUnit(item.value, item.unit)} options={UNITS_BY_METRIC[item.value]} onchange={(v) => update('unit', v)} />
        </label>
        {/if}
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Min</span>
            <Tooltip content={rangeBoundTooltip(item, 'min')} side="bottom" class="w-full">
              <Input value={numVal(item, 'min')} placeholder="number, min, or max" onchange={(e) => update('min', e.target.value)} />
            </Tooltip>
          </label>
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Max</span>
            <Tooltip content={rangeBoundTooltip(item, 'max')} side="bottom" class="w-full">
              <Input value={numVal(item, 'max')} placeholder="number, min, or max" onchange={(e) => update('max', e.target.value)} />
            </Tooltip>
          </label>
        </div>
        {#if rangeWarning(item)}
          <div class="flex items-start gap-1.5 rounded-[6px] border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-300">
            <AlertTriangle size={12} class="mt-0.5 shrink-0" />
            <span>{rangeWarning(item)}</span>
          </div>
        {/if}
        {#if showAdvanced}
        <button
          type="button"
          onclick={applyMeterActivityRange}
          class="w-full cursor-pointer rounded-[6px] border border-zinc-700 bg-zinc-900/50 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
        >
          Set min/max
        </button>
        {/if}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Direction</span>
          <Select
            value={item.direction ?? 'up'}
            options={METER_DIRECTIONS}
            onchange={(v) => update('direction', v)}
          />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Segments</span>
            <Input type="number" value={item.segments ?? ''} min={0} step={1} placeholder="off"
              oninput={(e) => update('segments', e.target.value)} />
          </label>
          {#if (item.segments ?? 0) >= 1}
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Gap (px)</span>
            <Input type="number" value={item.gap ?? 0} min={0} step={1}
              oninput={(e) => update('gap', e.target.value)} />
          </label>
          {/if}
        </div>
        {#if (item.segments ?? 0) >= 1}
        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-xs text-zinc-500">Gradient (min → max)</span>
            <button type="button" class="text-xs text-primary hover:underline"
              onclick={addGradientStop}>+ stop</button>
          </div>
          {#if meterGradient().length === 0}
            <p class="text-[10px] text-zinc-600 italic">No stops — uses the solid color below.</p>
          {/if}
          {#each meterGradient() as stop, i (i)}
            <div class="flex gap-2 items-center">
              <ColorInput
                value={stop ?? '#ffffff'}
                vars={sceneVars}
                onchange={(v) => updateGradientStop(i, v)}
                class="flex-1 min-w-0"
              />
              <button type="button" class="text-xs text-zinc-500 hover:text-red-400 px-1 shrink-0"
                onclick={() => removeGradientStop(i)} aria-label="Remove stop">✕</button>
            </div>
          {/each}
        </div>
        {/if}
        {#if showAdvanced}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Corner radius (px)</span>
          <Input type="number" value={item.radius ?? 0} min={0} step={1}
            oninput={(e) => update('radius', e.target.value)} />
        </label>
        {/if}
      </section>

      <!-- Fill (continuous meters only — segmented uses gradient stops in the Metric section) -->
      {#if !(item.segments >= 1)}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Fill</p>
        <div class="space-y-2">
          <label class="space-y-1 block">
            <span class="text-xs text-zinc-500">Low value</span>
            <ColorInput
              value={meterGradient()[0] ?? item.color ?? '#ffffff'}
              vars={sceneVars}
              onchange={(v) => updateContinuousGradientStop(0, v)}
            />
          </label>
          <label class="space-y-1 block">
            <span class="text-xs text-zinc-500">High value</span>
            <ColorInput
              value={meterGradient()[1] ?? item.color ?? '#ffffff'}
              vars={sceneVars}
              onchange={(v) => updateContinuousGradientStop(1, v)}
            />
          </label>
        </div>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Opacity (0–1)</span>
          <OpacityControl value={item.fill_opacity ?? item.opacity ?? 1}
            oninput={(e) => update('fill_opacity', e.target.value)} />
        </label>
      </section>
      {/if}

      <!-- Background (track — the empty portion of the meter) -->
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Background</p>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Color</span>
          <ColorInput
            value={item.background ?? ''}
            vars={sceneVars}
            placeholder="none"
            onchange={(v) => update('background', v || undefined)}
          />
        </label>
        {#if item.background}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Opacity (0–1)</span>
          <OpacityControl value={item.background_opacity ?? 1}
            oninput={(e) => update('background_opacity', e.target.value)} />
        </label>
        {/if}
      </section>

      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Border</p>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Color</span>
          <ColorInput
            value={item.border_color ?? ''}
            vars={sceneVars}
            placeholder="none"
            onchange={(v) => update('border_color', v || undefined)}
          />
        </label>
        {#if item.border_color}
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Width (px)</span>
            <Input type="number" value={item.border_width ?? 2} min={0.5} step={0.5}
              oninput={(e) => update('border_width', e.target.value)} />
          </label>
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Opacity (0–1)</span>
            <OpacityControl value={item.border_opacity ?? item.opacity ?? 1}
              oninput={(e) => update('border_opacity', e.target.value)} />
          </label>
        </div>
        {/if}
      </section>

      <!-- Scale (number line beside the meter) -->
      {#if showAdvanced}
      <section class="mb-4 space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-[10px] uppercase tracking-wider text-zinc-600">Scale</p>
          {#if scaleEnabled()}
            <button type="button" class="text-xs text-zinc-500 hover:text-red-400 transition-colors"
              onclick={disableScale}>Remove</button>
          {:else}
            <button type="button" class="text-xs text-primary hover:underline"
              onclick={enableScale}>+ Enable</button>
          {/if}
        </div>
        {#if scaleEnabled()}
          <div class="space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-xs text-zinc-500">Labels (empty = auto min/mid/max)</span>
              <button type="button" class="text-xs text-primary hover:underline"
                onclick={addScaleLabel}>+ add</button>
            </div>
            {#if (scaleLabels() ?? []).length === 0}
              <p class="text-[10px] text-zinc-600 italic">Auto: min, mid, max</p>
            {/if}
            {#each (scaleLabels() ?? []) as val, i (i)}
              <div class="flex gap-2 items-center">
                <Input type="number" value={val} step="any"
                  oninput={(e) => updateScaleLabel(i, e.target.value)}
                  class="flex-1 font-mono text-xs" />
                <button type="button" class="text-xs text-zinc-500 hover:text-red-400 px-1"
                  onclick={() => removeScaleLabel(i)} aria-label="Remove">✕</button>
              </div>
            {/each}
          </div>
          <label class="space-y-1 block">
            <span class="text-xs text-zinc-500">Label color</span>
            <ColorInput
              value={item.scale_color ?? ''}
              vars={sceneVars}
              placeholder="fill color"
              onchange={(v) => update('scale_color', v || undefined)}
            />
          </label>
          <label class="space-y-1 block">
            <span class="text-xs text-zinc-500">Suffix</span>
            <Input value={item.scale_suffix ?? ''} placeholder="e.g. mph"
              oninput={(e) => update('scale_suffix', e.target.value || undefined)} />
          </label>
          <label class="space-y-1 block">
            <span class="text-xs text-zinc-500">Font</span>
            <Select
              value={item.scale_font ?? ''}
              options={fontOpts(true)}
              onchange={(v) => update('scale_font', v || undefined)}
            />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="space-y-1">
              <span class="text-xs text-zinc-500">Font size (px)</span>
              <Input type="number" value={item.scale_font_size ?? 20} min={6} step={1}
                oninput={(e) => update('scale_font_size', e.target.value)} />
            </label>
            <label class="space-y-1">
              <span class="text-xs text-zinc-500">Label offset (px)</span>
              <Input type="number" value={item.scale_offset ?? 8} min={0} step={1}
                oninput={(e) => update('scale_offset', e.target.value)} />
            </label>
            <label class="space-y-1">
              <span class="text-xs text-zinc-500">End tick ext. (px)</span>
              <Input type="number" value={item.scale_tick_length ?? 6} min={0} step={1}
                oninput={(e) => update('scale_tick_length', e.target.value)} />
            </label>
            <label class="space-y-1">
              <span class="text-xs text-zinc-500">Tick width (px)</span>
              <Input type="number" value={item.scale_tick_width ?? 1} min={0} step={0.5}
                oninput={(e) => update('scale_tick_width', e.target.value)} />
            </label>
            <label class="space-y-1">
              <span class="text-xs text-zinc-500">Extra ticks (unlabeled)</span>
              <Input type="number" value={item.scale_ticks ?? 0} min={0} step={1}
                oninput={(e) => update('scale_ticks', e.target.value || undefined)} />
            </label>
          </div>
        {/if}
      </section>
      {/if}

    {/if}

    <!-- Gauge: metric + range + dial geometry -->
    {#if type === 'gauge'}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Metric</p>
        <Select
          value={item.value ?? ''}
          options={METER_METRICS.map((m) => ({ value: m, label: m }))}
          onchange={(v) => update('value', v)}
        />
        {#if UNITS_BY_METRIC[item.value]}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Unit</span>
          <Select value={displayUnit(item.value, item.unit)} options={UNITS_BY_METRIC[item.value]} onchange={(v) => update('unit', v)} />
        </label>
        {/if}
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Min</span>
            <Tooltip content={rangeBoundTooltip(item, 'min')} side="bottom" class="w-full">
              <Input value={numVal(item, 'min')} placeholder="number, min, or max" onchange={(e) => update('min', e.target.value)} />
            </Tooltip>
          </label>
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Max</span>
            <Tooltip content={rangeBoundTooltip(item, 'max')} side="bottom" class="w-full">
              <Input value={numVal(item, 'max')} placeholder="number, min, or max" onchange={(e) => update('max', e.target.value)} />
            </Tooltip>
          </label>
        </div>
        {#if rangeWarning(item)}
          <div class="flex items-start gap-1.5 rounded-[6px] border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-300">
            <AlertTriangle size={12} class="mt-0.5 shrink-0" />
            <span>{rangeWarning(item)}</span>
          </div>
        {/if}
        {#if showAdvanced}
        <button
          type="button"
          onclick={applyGaugeActivityRange}
          class="w-full cursor-pointer rounded-[6px] border border-zinc-700 bg-zinc-900/50 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
        >
          Set min/max
        </button>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Start angle (°)</span>
            <Input type="number" value={item.start_angle ?? 135} step={1}
              oninput={(e) => update('start_angle', e.target.value)} />
          </label>
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Sweep (°)</span>
            <Input type="number" value={item.sweep_angle ?? 270} step={1}
              oninput={(e) => update('sweep_angle', e.target.value)} />
          </label>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Arc width (px)</span>
            <Input type="number" value={item.arc_width ?? 14} min={0} step={1}
              oninput={(e) => update('arc_width', e.target.value)} />
          </label>
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Needle width (px)</span>
            <Input type="number" value={item.needle_width ?? 6} min={0} step={1}
              oninput={(e) => update('needle_width', e.target.value)} />
          </label>
        </div>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Track color</span>
          <ColorInput
            value={item.arc_color ?? ''}
            vars={sceneVars}
            placeholder="none"
            onchange={(v) => update('arc_color', v || undefined)}
          />
        </label>
        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-xs text-zinc-500">Progress gradient (start → end)</span>
            <button type="button" class="text-xs text-primary hover:underline"
              onclick={addGradientStop}>+ stop</button>
          </div>
          {#if meterGradient().length === 0}
            <p class="text-[10px] text-zinc-600 italic">No stops — uses progress color below.</p>
          {/if}
          {#each meterGradient() as stop, i (i)}
            <div class="flex gap-2 items-center">
              <ColorInput
                value={stop ?? '#ffffff'}
                vars={sceneVars}
                onchange={(v) => updateGradientStop(i, v)}
                class="flex-1 min-w-0"
              />
              <button type="button" class="text-xs text-zinc-500 hover:text-red-400 px-1 shrink-0"
                onclick={() => removeGradientStop(i)} aria-label="Remove stop">✕</button>
            </div>
          {/each}
        </div>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Progress color</span>
          <ColorInput
            value={item.progress_color ?? ''}
            vars={sceneVars}
            placeholder="none"
            onchange={(v) => update('progress_color', v || undefined)}
          />
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Needle color</span>
          <ColorInput
            value={item.needle_color ?? ''}
            vars={sceneVars}
            placeholder="base color"
            onchange={(v) => update('needle_color', v || undefined)}
          />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1 block col-span-2">
            <span class="text-xs text-zinc-500">Cap dot color</span>
            <ColorInput
              value={item.cap_color ?? ''}
              vars={sceneVars}
              placeholder="none"
              onchange={(v) => update('cap_color', v || undefined)}
            />
          </label>
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Cap radius (px)</span>
            <Input type="number" value={item.cap_radius ?? ''} min={0} step={1} placeholder="auto"
              oninput={(e) => update('cap_radius', e.target.value)} />
          </label>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={item.hide_track ?? false}
            onchange={(e) => update('hide_track', e.target.checked || undefined)}
            class="rounded" />
          <span class="text-xs text-zinc-400">Hide unfilled arc (current → max)</span>
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Background color</span>
          <ColorInput
            value={item.background_color ?? ''}
            vars={sceneVars}
            placeholder="none"
            onchange={(v) => update('background_color', v || undefined)}
          />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Opacity</span>
            <OpacityControl value={item.background_opacity ?? 0}
              oninput={(e) => update('background_opacity', e.target.value)} />
          </label>
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Margin (px)</span>
            <Input type="number" value={numVal(item, 'background_margin')} min={0} step={4}
              oninput={(e) => update('background_margin', e.target.value || undefined)} />
          </label>
        </div>
        {/if}
      </section>
    {/if}

    <!-- Line & Fill (plots only) -->
    {#if type === 'plot'}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Line</p>
        {#if showAdvanced}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Color</span>
          <ColorInput
            value={colorRow('line', 'color')}
            vars={sceneVars}
            onchange={(v) => updateNested('line', 'color', v)}
          />
        </label>
        {/if}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Width (px)</span>
          <Input type="number" value={item.line?.width ?? 1.75} min={0} step={0.25}
            oninput={(e) => updateNested('line', 'width', e.target.value)} />
        </label>
        {#if showAdvanced && item.value === 'course'}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Past opacity (traveled, 0–1)</span>
          <OpacityControl value={item.line?.past_opacity ?? 1}
            oninput={(e) => updateNested('line', 'past_opacity', e.target.value)} />
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Future opacity (ahead, 0–1)</span>
          <OpacityControl value={item.line?.future_opacity ?? 1}
            oninput={(e) => updateNested('line', 'future_opacity', e.target.value)} />
        </label>
        {/if}
      </section>

      {#if showAdvanced}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Fill</p>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Color</span>
          <ColorInput
            value={colorRow('fill', 'color')}
            vars={sceneVars}
            onchange={(v) => updateNested('fill', 'color', v)}
          />
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Opacity (0–1)</span>
          <OpacityControl value={item.fill?.opacity ?? 0}
            oninput={(e) => updateNested('fill', 'opacity', e.target.value)} />
        </label>
      </section>
      {/if}

      {#if item.value === 'course'}
      <section class="mb-4 space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-[10px] uppercase tracking-wider text-zinc-600">Course Markers</p>
          <button type="button" class="text-xs text-primary hover:underline" onclick={addCourseMarker}>+ marker</button>
        </div>
        {#if courseMarkers().length === 0}
          <p class="text-[10px] text-zinc-600 italic">No markers.</p>
        {:else}
          <div class="flex flex-wrap gap-1.5">
            {#each courseMarkers() as marker, i (marker.id ?? i)}
              <button
                type="button"
                class="rounded-[6px] border px-2 py-1 text-[11px] transition-colors
                  {(selectedCourseMarker()?.id ?? courseMarkers()[0]?.id) === marker.id
                    ? 'border-primary bg-primary/10 text-zinc-100'
                    : 'border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'}"
                onclick={() => (app.selectedCourseMarkerId = marker.id)}
              >
                {marker.name || `Marker ${i + 1}`}
              </button>
            {/each}
          </div>
          {@const marker = selectedCourseMarker()}
          {#if marker}
            <label class="space-y-1 block">
              <span class="text-xs text-zinc-500">Name</span>
              <Input value={marker.name ?? ''} oninput={(e) => updateCourseMarker('name', e.target.value)} />
            </label>
            <label class="space-y-1 block">
              <span class="text-xs text-zinc-500">Style</span>
              <Select
                value={marker.style ?? 'checkered'}
                options={COURSE_MARKER_STYLES}
                onchange={(v) => updateCourseMarker('style', v)}
              />
            </label>
            <label class="space-y-1 block">
              <span class="text-xs text-zinc-500">Distance from activity start (m)</span>
              <Input type="number" value={marker.distance ?? 0} min={0} step={10}
                oninput={(e) => updateCourseMarker('distance', e.target.value)} />
            </label>
            {#if (marker.style ?? 'checkered') !== 'checkered'}
            <label class="space-y-1 block">
              <span class="text-xs text-zinc-500">Color</span>
              <ColorInput
                value={marker.color ?? '#ef4444'}
                vars={sceneVars}
                onchange={(v) => updateCourseMarker('color', v)}
              />
            </label>
            {/if}
            <div class="grid grid-cols-2 gap-2">
              <label class="space-y-1">
                <span class="text-xs text-zinc-500">Width (px)</span>
                <Input type="number" value={marker.width ?? 34} min={1} step={1}
                  oninput={(e) => updateCourseMarker('width', e.target.value)} />
              </label>
              <label class="space-y-1">
                <span class="text-xs text-zinc-500">Height (px)</span>
                <Input type="number" value={marker.height ?? 10} min={1} step={1}
                  oninput={(e) => updateCourseMarker('height', e.target.value)} />
              </label>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <label class="space-y-1">
                <span class="text-xs text-zinc-500">Rotation trim (°)</span>
                <Input type="number" value={marker.rotation ?? 0} step={1}
                  oninput={(e) => updateCourseMarker('rotation', e.target.value)} />
              </label>
              <label class="space-y-1">
                <span class="text-xs text-zinc-500">Opacity (0–1)</span>
                <OpacityControl value={marker.opacity ?? 1}
                  oninput={(e) => updateCourseMarker('opacity', e.target.value)} />
              </label>
            </div>
            <button type="button" class="text-xs text-zinc-500 hover:text-red-400"
              onclick={() => removeCourseMarker(marker.id)}>Remove marker</button>
          {/if}
        {/if}
      </section>
      {/if}

      <!-- Tracking point -->
      {@const pt = item.point ?? {}}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Tracking Point</p>
        {#if showAdvanced}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Color</span>
          <ColorInput
            value={pt.color ?? '#ffffff'}
            vars={sceneVars}
            onchange={(v) => updatePoint('color', v)}
          />
        </label>
        {/if}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Size (area px²)</span>
          <Input type="number" value={pt.weight ?? 80} min={4} step={4}
            oninput={(e) => updatePoint('weight', e.target.value)} />
        </label>
        {#if showAdvanced}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Edge Color</span>
          <ColorInput
            value={pt.edge_color ?? '#000000'}
            vars={sceneVars}
            onchange={(v) => updatePoint('edge_color', v)}
          />
        </label>
        {#if !(pt.remove_edge_color ?? false)}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Edge width (px)</span>
          <Input type="number" value={pt.edge_width ?? 1} min={0} step={0.5}
            oninput={(e) => updatePoint('edge_width', e.target.value)} />
        </label>
        {/if}
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={pt.remove_edge_color ?? false}
            onchange={(e) => updatePoint('remove_edge_color', e.target.checked)}
            class="accent-primary" />
          <span class="text-xs text-zinc-400">Remove edge</span>
        </label>
        {/if}
      </section>

      <!-- Point Label — value text next to the marker -->
      {#if showAdvanced}
      {@const pl = item.point_label}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Point Label</p>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={pl != null}
            onchange={(e) => togglePointLabel(e.target.checked)}
            class="accent-primary" />
          <span class="text-xs text-zinc-400">Show current value at the marker</span>
        </label>
        {#if pl != null}
          <div class="flex gap-4">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={(pl.units ?? []).includes('metric')}
                onchange={(e) => toggleUnit('metric', e.target.checked)}
                class="accent-primary" />
              <span class="text-xs text-zinc-400">Metric</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={(pl.units ?? []).includes('imperial')}
                onchange={(e) => toggleUnit('imperial', e.target.checked)}
                class="accent-primary" />
              <span class="text-xs text-zinc-400">Imperial</span>
            </label>
          </div>
          <label class="space-y-1 block">
            <span class="text-xs text-zinc-500">Font</span>
            <Select
              value={pl.font ?? 'Furore.otf'}
              options={fontOpts(false)}
              onchange={(v) => updatePL('font', v)}
            />
          </label>
          <label class="space-y-1 block">
            <span class="text-xs text-zinc-500">Size</span>
            <Input type="number" value={pl.font_size ?? 64} min={1}
              oninput={(e) => updatePL('font_size', e.target.value)} />
          </label>
          <label class="flex items-center justify-between gap-3 rounded-[6px] border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
            <span class="text-xs text-zinc-500">Italic</span>
            <Switch checked={pl.italic ?? false} ariaLabel="Italic point label" onchange={(v) => updatePL('italic', v ? true : undefined)} />
          </label>
          <label class="space-y-1 block">
            <span class="text-xs text-zinc-500">Color</span>
            <ColorInput
              value={pl.color ?? '#ffffffc8'}
              vars={sceneVars}
              onchange={(v) => updatePL('color', v)}
            />
          </label>
          <div class="flex gap-2">
            <label class="space-y-1 block flex-1">
              <span class="text-xs text-zinc-500">X offset</span>
              <Input type="number" value={pl.x_offset ?? 0}
                oninput={(e) => updatePL('x_offset', e.target.value)} />
            </label>
            <label class="space-y-1 block flex-1">
              <span class="text-xs text-zinc-500">Y offset</span>
              <Input type="number" value={pl.y_offset ?? 0}
                oninput={(e) => updatePL('y_offset', e.target.value)} />
            </label>
          </div>
          <label class="space-y-1 block">
            <span class="text-xs text-zinc-500">Decimal places</span>
            <Input type="number" value={pl.decimal_rounding ?? 0} min={0} step={1}
              oninput={(e) => updatePL('decimal_rounding', e.target.value)} />
          </label>
        {/if}
      </section>
      {/if}
    {/if}

    <!-- Typography (label + value) -->
    {#if type !== 'plot' && type !== 'rect' && type !== 'image'}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Typography</p>
        {#if showAdvanced}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Font</span>
          <Select
            value={item.font ?? ''}
            options={fontOpts(true)}
            onchange={(v) => update('font', v || undefined)}
          />
        </label>
        {/if}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Size</span>
          <Input type="number" value={numVal(item, 'font_size')} placeholder="Scene default" oninput={(e) => update('font_size', e.target.value)} />
        </label>
        {#if type === 'label'}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Letter spacing (px)</span>
          <Input type="number" value={numVal(item, 'letter_spacing')} placeholder="0" step={0.5} oninput={(e) => update('letter_spacing', e.target.value)} />
        </label>
        {/if}
        <label class="flex items-center justify-between gap-3 rounded-[6px] border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
          <span class="text-xs text-zinc-500">Italic</span>
          <Switch checked={item.italic ?? false} ariaLabel="Italic text" onchange={(v) => update('italic', v ? true : undefined)} />
        </label>
        {#if showAdvanced && (type === 'label' || type === 'value')}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Alignment</span>
          <Select
            value={item.text_align ?? 'left'}
            options={[{value:'left',label:'Left'},{value:'center',label:'Center'},{value:'right',label:'Right'}]}
            onchange={(v) => update('text_align', v)}
          />
        </label>
        {/if}
      </section>
    {/if}

    <!-- Appearance (not shown for rect/meter/image — image handles opacity in size section) -->
    {#if type !== 'rect' && type !== 'meter' && type !== 'image'}
    <section class="mb-4 space-y-2">
      <p class="text-[10px] uppercase tracking-wider text-zinc-600">Appearance</p>
      {#if showAdvanced}
      <label class="space-y-1 block">
        <span class="text-xs text-zinc-500">Color</span>
        <ColorInput
          value={item.color ?? '#ffffff'}
          vars={sceneVars}
          onchange={(v) => update('color', v)}
        />
      </label>
      {:else}
      <label class="space-y-1 block">
        <span class="text-xs text-zinc-500">Color</span>
        <ColorInput
          value={primaryColor()}
          vars={sceneVars}
          onchange={(v) => setAllColors(v)}
        />
      </label>
      {/if}
      {#if showAdvanced}
      <label class="space-y-1 block">
        <span class="text-xs text-zinc-500">Opacity (0–1)</span>
        <OpacityControl value={item.opacity ?? app.config?.scene?.opacity ?? 1} oninput={(e) => update('opacity', e.target.value)} />
      </label>
      {/if}
    </section>
    {/if}

    <!-- Value-specific -->
    {#if type === 'value'}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Formatting</p>
        {#if item.value === 'distance'}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Unit</span>
          <Select value={displayUnit('distance', item.unit)} options={UNITS_BY_METRIC.distance} onchange={(v) => changeDistanceUnit(v)} />
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Reference</span>
          <Select
            value={item.distance_reference ?? 'overlay_start'}
            options={DISTANCE_REFERENCES}
            onchange={(v) => update('distance_reference', v)}
          />
        </label>
        {#if item.distance_reference === 'until_custom' || item.distance_reference === 'since_custom'}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Point ({displayUnit('distance', item.unit)})</span>
          {#if displayUnit('distance', item.unit) === 'm'}
          <Input type="number"
            value={item.distance_target != null ? Math.round(item.distance_target) : ''}
            min={0} step={1}
            oninput={(e) => app.updateElement(selected().id, { distance_target: e.target.value === '' ? undefined : Math.round(Number(e.target.value)) })} />
          {:else}
          <Input type="number" value={numVal(item, 'distance_target')} min={0} step={0.1}
            oninput={(e) => update('distance_target', e.target.value)} />
          {/if}
        </label>
        {/if}
        {:else if UNITS_BY_METRIC[item.value]}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Unit</span>
          <Select value={displayUnit(item.value, item.unit)} options={UNITS_BY_METRIC[item.value]} onchange={(v) => update('unit', v)} />
        </label>
        {/if}
        {#if showAdvanced}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Suffix</span>
          <Input value={item.suffix ?? ''} placeholder="e.g. mph" oninput={(e) => update('suffix', e.target.value || undefined)} />
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Decimal places</span>
          <Input type="number" value={numVal(item, 'decimal_rounding')} min={0} max={4} oninput={(e) => update('decimal_rounding', e.target.value)} />
        </label>
        {/if}
      </section>
    {/if}
  {/if}
</div>
