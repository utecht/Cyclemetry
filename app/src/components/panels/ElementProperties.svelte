<script>
  /**
   * Right panel: property editor for the currently selected element.
   * All changes write directly into app.config via app.updateElement().
   */
  import { getContext } from 'svelte'
  import Input from '../ui/Input.svelte'
  import Select from '../ui/Select.svelte'
  import Switch from '../ui/Switch.svelte'
  import { elementTypeName } from '../../lib/elementTypes.js'

  const app = getContext('app')

  // Single source of truth: app.fonts (bundled ∪ user-installed).
  // Importing new fonts lives in the Templates menu (Add Custom Font…).
  function fontOpts(includeSceneDefault) {
    return [
      ...(includeSceneDefault ? [{ value: '', label: 'Scene default' }] : []),
      ...app.fonts.map((f) => ({ value: f, label: f.replace(/\.(ttf|otf)$/i, '') })),
    ]
  }
  const METRICS = ['speed', 'heartrate', 'power', 'elevation', 'cadence', 'gradient', 'temperature', 'time', 'distance']
  const PLOT_METRICS = ['elevation', 'speed', 'heartrate', 'power', 'cadence', 'gradient', 'temperature', 'course', 'distance']
  const METER_METRICS = ['speed', 'heartrate', 'power', 'elevation', 'cadence', 'gradient', 'temperature']
  const METER_DIRECTIONS = [
    { value: 'up', label: 'Fill upward' },
    { value: 'down', label: 'Fill downward' },
    { value: 'right', label: 'Fill rightward' },
    { value: 'left', label: 'Fill leftward' },
  ]
  const DISTANCE_REFERENCES = [
    { value: 'overlay_start', label: 'Since overlay start' },
    { value: 'activity_start', label: 'Since activity start' },
    { value: 'overlay_end', label: 'Until overlay end' },
    { value: 'activity_end', label: 'Until activity end' },
    { value: 'custom', label: 'Until custom point' },
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

  function update(field, raw) {
    const s = selected()
    if (!s) return
    const numFields = ['x', 'y', 'width', 'height', 'font_size', 'opacity', 'decimal_rounding', 'rotation', 'distance_target', 'min', 'max', 'radius', 'start_angle', 'sweep_angle', 'arc_width', 'needle_width', 'segments', 'gap']
    const value = numFields.includes(field) ? (raw === '' ? undefined : Number(raw)) : raw
    app.updateElement(s.id, { [field]: value })
  }

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

  // Update points[0] — the tracking marker. Creates it if absent.
  function updatePoint(field, raw) {
    const s = selected()
    if (!s) return
    const numFields = ['weight', 'opacity']
    const value = numFields.includes(field) ? (raw === '' ? undefined : Number(raw)) : raw
    const current = s.item.points?.[0] ?? {}
    app.updateElement(s.id, { points: [{ ...current, [field]: value }] })
  }

  // Point label (value text next to the chart marker, e.g. "960 M").
  const POINT_LABEL_DEFAULT = {
    font: 'Furore.otf',
    font_size: 64,
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
    const value = numFields.includes(field)
      ? raw === ''
        ? undefined
        : Number(raw)
      : raw
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
      it.points?.[0]?.color ??
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
      if (it.points?.[0]) patch.points = [{ ...it.points[0], color: raw }]
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

  // Continuous fill: always exactly 2 stops (start / end).
  function updateContinuousGradientStop(idx, val) {
    const cur = meterGradient()
    const stops = cur.length >= 2 ? [...cur] : ['#ffffff', '#ffffff']
    stops[idx] = val
    setGradient(stops.slice(0, 2))
  }

  // Progressive disclosure: most overlays reuse the same colors/fonts/line
  // weights, so detailed/structural controls hide behind "Advanced".
  let showAdvanced = $state(false)
</script>

<div class="h-full overflow-y-auto px-4 py-3">
  {#if !selected()}
    <div class="flex h-full items-center justify-center">
      <p class="text-xs text-zinc-600 italic text-center">Click an element on the canvas<br>or in the list to edit it.</p>
    </div>
  {:else}
    {@const { item, type } = selected()}

    <p class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">
      {elementTypeName(item)}
    </p>

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
      <p class="text-[10px] uppercase tracking-wider text-zinc-600">Position</p>
      <div class="grid grid-cols-2 gap-2">
        <label class="space-y-1">
          <span class="text-xs text-zinc-500">X</span>
          <Input type="number" value={numVal(item, 'x')} oninput={(e) => update('x', e.target.value)} />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-zinc-500">Y</span>
          <Input type="number" value={numVal(item, 'y')} oninput={(e) => update('y', e.target.value)} />
        </label>
      </div>
    </section>

    <!-- Size (plot + meter, advanced) + rotation (plot only) -->
    {#if showAdvanced && (type === 'plot' || type === 'meter' || type === 'gauge')}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Size</p>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Width</span>
            <Input type="number" value={numVal(item, 'width')} oninput={(e) => update('width', e.target.value)} />
          </label>
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Height</span>
            <Input type="number" value={numVal(item, 'height')} oninput={(e) => update('height', e.target.value)} />
          </label>
        </div>
        {#if type === 'plot' || type === 'meter' || type === 'gauge'}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Rotation (°)</span>
          <Input type="number" value={item.rotation ?? 0} min={-180} max={180} step={1}
            oninput={(e) => update('rotation', e.target.value)} />
        </label>
        {/if}
      </section>
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
            <Input type="number" value={numVal(item, 'min')} oninput={(e) => update('min', e.target.value)} />
          </label>
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Max</span>
            <Input type="number" value={numVal(item, 'max')} oninput={(e) => update('max', e.target.value)} />
          </label>
        </div>
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
              <input type="color" value={(stop ?? '#ffffff').slice(0, 7)}
                oninput={(e) => updateGradientStop(i, e.target.value)}
                class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5" />
              <Input value={stop ?? ''} oninput={(e) => updateGradientStop(i, e.target.value)} class="flex-1 font-mono text-xs" />
              <button type="button" class="text-xs text-zinc-500 hover:text-red-400 px-1"
                onclick={() => removeGradientStop(i)} aria-label="Remove stop">✕</button>
            </div>
          {/each}
        </div>
        {:else}
        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-xs text-zinc-500">Gradient</span>
            {#if meterGradient().length === 0}
            <button type="button" class="text-xs text-primary hover:underline"
              onclick={() => setGradient([item.color ?? '#ffffff', '#ffffff'])}>+ enable</button>
            {:else}
            <button type="button" class="text-xs text-zinc-500 hover:text-red-400"
              onclick={() => setGradient([])}>remove</button>
            {/if}
          </div>
          {#if meterGradient().length >= 2}
          <div class="grid grid-cols-2 gap-2">
            <label class="space-y-1">
              <span class="text-[10px] text-zinc-600">Start</span>
              <div class="flex gap-2 items-center">
                <input type="color" value={(meterGradient()[0] ?? '#ffffff').slice(0, 7)}
                  oninput={(e) => updateContinuousGradientStop(0, e.target.value)}
                  class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5" />
                <Input value={meterGradient()[0] ?? '#ffffff'}
                  oninput={(e) => updateContinuousGradientStop(0, e.target.value)}
                  class="flex-1 font-mono text-xs" />
              </div>
            </label>
            <label class="space-y-1">
              <span class="text-[10px] text-zinc-600">End</span>
              <div class="flex gap-2 items-center">
                <input type="color" value={(meterGradient()[1] ?? '#ffffff').slice(0, 7)}
                  oninput={(e) => updateContinuousGradientStop(1, e.target.value)}
                  class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5" />
                <Input value={meterGradient()[1] ?? '#ffffff'}
                  oninput={(e) => updateContinuousGradientStop(1, e.target.value)}
                  class="flex-1 font-mono text-xs" />
              </div>
            </label>
          </div>
          {/if}
        </div>
        {/if}
        {#if showAdvanced}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Corner radius (px)</span>
          <Input type="number" value={item.radius ?? 0} min={0} step={1}
            oninput={(e) => update('radius', e.target.value)} />
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Track color</span>
          <div class="flex gap-2 items-center">
            <input type="color" value={(item.background ?? '#ffffff').slice(0, 7)}
              oninput={(e) => update('background', e.target.value)}
              class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5" />
            <Input value={item.background ?? ''} placeholder="none" oninput={(e) => update('background', e.target.value || undefined)} class="flex-1 font-mono text-xs" />
          </div>
        </label>
        {/if}
      </section>
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
            <Input type="number" value={numVal(item, 'min')} oninput={(e) => update('min', e.target.value)} />
          </label>
          <label class="space-y-1">
            <span class="text-xs text-zinc-500">Max</span>
            <Input type="number" value={numVal(item, 'max')} oninput={(e) => update('max', e.target.value)} />
          </label>
        </div>
        {#if showAdvanced}
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
          <div class="flex gap-2 items-center">
            <input type="color" value={(item.arc_color ?? '#ffffff').slice(0, 7)}
              oninput={(e) => update('arc_color', e.target.value)}
              class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5" />
            <Input value={item.arc_color ?? ''} placeholder="none" oninput={(e) => update('arc_color', e.target.value || undefined)} class="flex-1 font-mono text-xs" />
          </div>
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Progress color</span>
          <div class="flex gap-2 items-center">
            <input type="color" value={(item.progress_color ?? '#ffffff').slice(0, 7)}
              oninput={(e) => update('progress_color', e.target.value)}
              class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5" />
            <Input value={item.progress_color ?? ''} placeholder="none" oninput={(e) => update('progress_color', e.target.value || undefined)} class="flex-1 font-mono text-xs" />
          </div>
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Needle color</span>
          <div class="flex gap-2 items-center">
            <input type="color" value={(item.needle_color ?? '#ef4444').slice(0, 7)}
              oninput={(e) => update('needle_color', e.target.value)}
              class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5" />
            <Input value={item.needle_color ?? ''} placeholder="base color" oninput={(e) => update('needle_color', e.target.value || undefined)} class="flex-1 font-mono text-xs" />
          </div>
        </label>
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
          <div class="flex gap-2 items-center">
            <input type="color" value={colorRow('line', 'color')}
              oninput={(e) => updateNested('line', 'color', e.target.value)}
              class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5" />
            <Input value={colorRow('line', 'color')} oninput={(e) => updateNested('line', 'color', e.target.value)} class="flex-1 font-mono text-xs" />
          </div>
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
          <Input type="number" value={item.line?.past_opacity ?? 1} min={0} max={1} step={0.05}
            oninput={(e) => updateNested('line', 'past_opacity', e.target.value)} />
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Future opacity (ahead, 0–1)</span>
          <Input type="number" value={item.line?.future_opacity ?? 1} min={0} max={1} step={0.05}
            oninput={(e) => updateNested('line', 'future_opacity', e.target.value)} />
        </label>
        {/if}
      </section>

      {#if showAdvanced}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Fill</p>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Color</span>
          <div class="flex gap-2 items-center">
            <input type="color" value={colorRow('fill', 'color')}
              oninput={(e) => updateNested('fill', 'color', e.target.value)}
              class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5" />
            <Input value={colorRow('fill', 'color')} oninput={(e) => updateNested('fill', 'color', e.target.value)} class="flex-1 font-mono text-xs" />
          </div>
        </label>
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Opacity (0–1)</span>
          <Input type="number" value={item.fill?.opacity ?? 0} min={0} max={1} step={0.05}
            oninput={(e) => updateNested('fill', 'opacity', e.target.value)} />
        </label>
      </section>
      {/if}

      <!-- Tracking point — points[0] -->
      {@const pt = item.points?.[0] ?? {}}
      <section class="mb-4 space-y-2">
        <p class="text-[10px] uppercase tracking-wider text-zinc-600">Tracking Point</p>
        {#if showAdvanced}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Color</span>
          <div class="flex gap-2 items-center">
            <input type="color" value={pt.color ?? '#ffffff'}
              oninput={(e) => updatePoint('color', e.target.value)}
              class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5" />
            <Input value={pt.color ?? '#ffffff'} oninput={(e) => updatePoint('color', e.target.value)} class="flex-1 font-mono text-xs" />
          </div>
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
          <div class="flex gap-2 items-center">
            <input type="color" value={pt.edge_color ?? '#000000'}
              oninput={(e) => updatePoint('edge_color', e.target.value)}
              class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5" />
            <Input value={pt.edge_color ?? '#000000'} oninput={(e) => updatePoint('edge_color', e.target.value)} class="flex-1 font-mono text-xs" />
          </div>
        </label>
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
          <label class="space-y-1 block">
            <span class="text-xs text-zinc-500">Color</span>
            <div class="flex gap-2 items-center">
              <input type="color" value={(pl.color ?? '#ffffff').slice(0, 7)}
                oninput={(e) => updatePL('color', e.target.value)}
                class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5" />
              <Input value={pl.color ?? '#ffffffc8'} oninput={(e) => updatePL('color', e.target.value)} class="flex-1 font-mono text-xs" />
            </div>
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
    {#if type !== 'plot'}
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
      </section>
    {/if}

    <!-- Appearance -->
    <section class="mb-4 space-y-2">
      <p class="text-[10px] uppercase tracking-wider text-zinc-600">Appearance</p>
      {#if showAdvanced}
      <label class="space-y-1 block">
        <span class="text-xs text-zinc-500">Color</span>
        <div class="flex gap-2 items-center">
          <input
            type="color"
            value={item.color ?? '#ffffff'}
            oninput={(e) => update('color', e.target.value)}
            class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5"
          />
          <Input value={item.color ?? '#ffffff'} oninput={(e) => update('color', e.target.value)} class="flex-1 font-mono text-xs" />
        </div>
      </label>
      {:else}
      <label class="space-y-1 block">
        <span class="text-xs text-zinc-500">Color</span>
        <div class="flex gap-2 items-center">
          <input
            type="color"
            value={primaryColor().slice(0, 7)}
            oninput={(e) => setAllColors(e.target.value)}
            class="h-7 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5"
          />
          <Input value={primaryColor()} oninput={(e) => setAllColors(e.target.value)} class="flex-1 font-mono text-xs" />
        </div>
      </label>
      {/if}
      {#if showAdvanced}
      <label class="space-y-1 block">
        <span class="text-xs text-zinc-500">Opacity (0–1)</span>
        <Input type="number" value={item.opacity ?? app.config?.scene?.opacity ?? 1} min={0} max={1} step={0.05} oninput={(e) => update('opacity', e.target.value)} />
      </label>
      {/if}
    </section>

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
        {#if item.distance_reference === 'custom'}
        <label class="space-y-1 block">
          <span class="text-xs text-zinc-500">Target ({displayUnit('distance', item.unit)})</span>
          <Input type="number" value={numVal(item, 'distance_target')} min={0} step={0.1}
            oninput={(e) => update('distance_target', e.target.value)} />
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
