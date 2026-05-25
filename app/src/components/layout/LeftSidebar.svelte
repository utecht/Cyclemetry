<script>
  import { getContext } from 'svelte'
  import { Plus, X, Film, AlertTriangle } from 'lucide-svelte'
  import TemplateSection from '../panels/TemplateSection.svelte'
  import ElementList from '../panels/ElementList.svelte'
  import Select from '../ui/Select.svelte'

  const app = getContext('app')

  const fontGroup = (font) =>
    font.source === 'system' ? 'System fonts' : 'Font files'

  function fontOpts() {
    return app.fonts.map((font) => ({
      value: font.value,
      label: font.label,
      group: fontGroup(font),
    }))
  }

  function onSceneFont(v) {
    app.updateScene({ font: v })
  }

  // Resolution presets — common formats for cycling/action cam footage sharing
  const RES_PRESETS = [
    { label: '4K', w: 3840, h: 2160 },
    { label: '1080p', w: 1920, h: 1080 },
    { label: '720p', w: 1280, h: 720 },
    { label: 'Portrait', w: 1080, h: 1920 },
    { label: 'Square', w: 1080, h: 1080 },
  ]

  // h:mm:ss when >= 1 hour, m:ss otherwise
  function secToTimecode(s) {
    const whole = Math.floor(s)
    const frac = s - whole
    const h = Math.floor(whole / 3600)
    const m = Math.floor((whole % 3600) / 60)
    const sec = whole % 60
    const ss =
      frac > 0
        ? (sec + frac).toFixed(3).padStart(6, '0')
        : String(sec).padStart(2, '0')
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
    return `${m}:${ss}`
  }

  // Accepts h:mm:ss, m:ss, or plain seconds. Plain seconds may be fractional.
  function timecodeToSec(str) {
    str = str.trim()
    if (/^\d+:\d{1,2}:\d{1,2}(?:\.\d+)?$/.test(str)) {
      const [h, m, s] = str.split(':').map(Number)
      return h * 3600 + m * 60 + s
    }
    if (/^\d+:\d{1,2}(?:\.\d+)?$/.test(str)) {
      const [m, s] = str.split(':').map(Number)
      return m * 60 + s
    }
    const n = Number(str)
    return !isNaN(n) && n >= 0 ? n : NaN
  }

  function videoBasename(path) {
    if (!path) return ''
    return path.split(/[\\/]/).pop()
  }

  let timelineError = $derived.by(() => {
    const s = app.config?.scene
    if (!s) return null
    const start = s.start ?? 0
    const end = s.end ?? app.timelineDuration
    if (start >= end)
      return `Start must be before end (${secToTimecode(start)} ≥ ${secToTimecode(end)})`
    return null
  })
</script>

<aside
  class="w-[272px] shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-900/30 overflow-hidden"
>
  <TemplateSection />

  <!-- Scene settings -->
  {#if app.config?.scene}
    <section class="px-4 py-3 border-b border-zinc-800 space-y-3">
      <p
        class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
      >
        Scene
      </p>

      <!-- Resolution -->
      <div class="space-y-1.5">
        <span class="text-[11px] text-zinc-500">Resolution</span>
        <div class="flex items-center gap-1.5">
          <input
            type="number"
            value={app.outputWidth}
            min={1}
            oninput={(e) => {
              const v = parseInt(e.target.value)
              if (v > 0) app.outputWidth = v
            }}
            class="h-7 w-full rounded-[6px] border border-zinc-700 bg-zinc-800/60 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
          />
          <span class="text-zinc-600 text-xs shrink-0">×</span>
          <input
            type="number"
            value={app.outputHeight}
            min={1}
            oninput={(e) => {
              const v = parseInt(e.target.value)
              if (v > 0) app.outputHeight = v
            }}
            class="h-7 w-full rounded-[6px] border border-zinc-700 bg-zinc-800/60 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
          />
        </div>
        <div class="flex flex-wrap gap-1">
          {#each RES_PRESETS as p (p.label)}
            {@const active =
              app.outputWidth === p.w && app.outputHeight === p.h}
            <button
              onclick={() => {
                app.outputWidth = p.w
                app.outputHeight = p.h
              }}
              class="rounded px-1.5 py-0.5 text-[10px] border transition-colors duration-[150ms]
                {active
                ? 'border-zinc-500 text-zinc-300 bg-zinc-800'
                : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'}"
              >{p.label}</button
            >
          {/each}
        </div>
      </div>

      <!-- Font (scene default — elements inherit unless overridden) -->
      <div class="space-y-1">
        <span class="text-[11px] text-zinc-500">Font</span>
        <Select
          value={app.config.scene.font ?? 'Arial.ttf'}
          options={fontOpts()}
          onchange={onSceneFont}
        />
      </div>

      <!-- FPS -->
      <label class="flex items-center justify-between">
        <span class="text-[11px] text-zinc-500">FPS</span>
        <input
          type="number"
          min="1"
          max="240"
          value={app.config.scene.fps ?? 30}
          oninput={(e) => {
            const v = parseInt(e.target.value)
            if (v > 0) app.updateScene({ fps: v })
          }}
          class="h-7 w-24 rounded-[6px] border border-zinc-700 bg-zinc-800/60 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
        />
      </label>

      <!-- Timeline range -->
      <div class="space-y-1">
        <div class="flex items-baseline justify-between">
          <span class="text-[11px] text-zinc-500">Timeline</span>
          <button
            onclick={() => app.updateScene({ end: app.timelineDuration })}
            title="Set end to activity duration"
            class="text-[11px] text-zinc-600 hover:text-zinc-300 transition-colors duration-[150ms] tabular-nums"
            >{secToTimecode(app.timelineDuration)} total</button
          >
        </div>
        <div class="flex gap-2 items-center">
          <input
            type="text"
            value={secToTimecode(app.config.scene.start ?? 0)}
            placeholder="0:00"
            onchange={(e) => {
              const v = timecodeToSec(e.target.value)
              if (!isNaN(v))
                app.updateScene({
                  start: Math.min(Math.max(0, v), app.timelineDuration),
                })
              else e.target.value = secToTimecode(app.config.scene.start ?? 0)
            }}
            class="h-7 w-full rounded-[6px] border bg-zinc-800/60 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono
              {timelineError ? 'border-red-500' : 'border-zinc-700'}"
          />
          <span class="text-zinc-600 text-xs shrink-0">→</span>
          <input
            type="text"
            value={secToTimecode(app.config.scene.end ?? app.timelineDuration)}
            placeholder={secToTimecode(app.timelineDuration)}
            onchange={(e) => {
              if (e.target.value.trim().toLowerCase() === 'end') {
                app.updateScene({ end: app.timelineDuration })
                e.target.value = secToTimecode(app.timelineDuration)
                return
              }
              const v = timecodeToSec(e.target.value)
              if (!isNaN(v))
                app.updateScene({
                  end: Math.min(Math.max(0, v), app.timelineDuration),
                })
              else
                e.target.value = secToTimecode(
                  app.config.scene.end ?? app.timelineDuration,
                )
            }}
            class="h-7 w-full rounded-[6px] border bg-zinc-800/60 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono
              {timelineError ? 'border-red-500' : 'border-zinc-700'}"
          />
        </div>
        {#if timelineError}
          <p class="text-[11px] text-red-500">{timelineError}</p>
        {/if}
      </div>

      <!-- Color variables -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-zinc-500">Color variables</span>
          <button
            onclick={() => {
              const vars = { ...(app.config.scene.vars ?? {}) }
              let n = 1
              while (vars[`color${n}`] !== undefined) n++
              vars[`color${n}`] = '#ffffff'
              app.updateScene({ vars })
            }}
            title="Add color variable"
            class="h-5 w-5 rounded flex items-center justify-center text-zinc-500
                   hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            <Plus size={12} />
          </button>
        </div>
        {#each Object.entries(app.config.scene.vars ?? {}) as [name, value] (name)}
          <div class="flex items-center gap-1.5">
            <input
              type="color"
              {value}
              oninput={(e) => {
                const vars = { ...(app.config.scene.vars ?? {}) }
                vars[name] = e.target.value
                app.updateScene({ vars })
              }}
              class="h-7 w-7 shrink-0 rounded-[4px] border border-zinc-700 bg-transparent cursor-pointer p-0.5"
              title={value}
            />
            <input
              type="text"
              value={name}
              onchange={(e) => {
                const newName = e.target.value.trim().replace(/\s+/g, '_')
                if (!newName || newName === name) {
                  e.target.value = name
                  return
                }
                const entries = Object.entries(app.config.scene.vars ?? {})
                const vars = Object.fromEntries(
                  entries.map(([k, v]) => [k === name ? newName : k, v]),
                )
                app.updateScene({ vars })
              }}
              class="min-w-0 flex-1 h-7 rounded-[6px] border border-zinc-700 bg-zinc-800/60 px-2 text-xs
                     text-zinc-300 font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              title="Variable name — reference as ${name} in any color field"
            />
            <button
              onclick={() => {
                const vars = Object.fromEntries(
                  Object.entries(app.config.scene.vars ?? {}).filter(
                    ([k]) => k !== name,
                  ),
                )
                app.updateScene({ vars })
              }}
              title="Remove variable"
              class="h-5 w-5 shrink-0 rounded flex items-center justify-center text-zinc-600
                     hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              <X size={11} />
            </button>
          </div>
        {/each}
        {#if Object.keys(app.config.scene.vars ?? {}).length === 0}
          <p class="text-[10px] text-zinc-600">
            No variables. Add one above and reference it as $name in any color
            field.
          </p>
        {/if}
      </div>
    </section>
  {/if}

  <!-- Reference video (Phase 1: probe + metadata only) -->
  <section class="px-4 py-3 border-b border-zinc-800 space-y-2">
    <p
      class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
    >
      Video
    </p>

    {#if !app.video}
      <button
        onclick={() => app.pickAndLoadVideo()}
        class="w-full h-7 rounded-[6px] border border-dashed border-zinc-700
               bg-zinc-800/30 px-2 text-xs text-zinc-400
               hover:border-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60
               flex items-center justify-center gap-1.5
               transition-colors duration-[150ms]"
      >
        <Film size={12} />
        Add video…
      </button>
      <p class="text-[10px] text-zinc-600 leading-snug">
        Optional: load a video to align overlay start/end against real footage.
      </p>
    {:else}
      {#if app.video.missing}
        <div
          class="rounded-[6px] border border-red-900/60 bg-red-950/30 px-2 py-1.5 space-y-1.5"
        >
          <div class="flex items-start gap-1.5 text-[11px] text-red-300">
            <AlertTriangle size={12} class="mt-0.5 shrink-0" />
            <span class="leading-snug">Video file is missing or moved.</span>
          </div>
          <div class="flex gap-1.5">
            <button
              onclick={() => app.pickAndLoadVideo()}
              class="flex-1 h-6 rounded border border-red-800/60 bg-red-900/40
                     px-2 text-[11px] text-red-100
                     hover:bg-red-900/70 transition-colors"
              >Locate video…</button
            >
            <button
              onclick={() => app.clearVideo()}
              class="h-6 px-2 rounded border border-zinc-700 text-[11px]
                     text-zinc-400 hover:text-zinc-200 hover:border-zinc-500
                     transition-colors"
              >Remove</button
            >
          </div>
        </div>
      {/if}

      <div class="space-y-1">
        <div class="flex items-center gap-1.5">
          <Film size={11} class="text-zinc-500 shrink-0" />
          <span
            class="text-[11px] text-zinc-300 truncate font-mono"
            title={app.video.path}>{videoBasename(app.video.path)}</span
          >
          <button
            onclick={() => app.clearVideo()}
            title="Remove video"
            class="ml-auto h-5 w-5 shrink-0 rounded flex items-center
                   justify-center text-zinc-600 hover:text-zinc-300
                   hover:bg-zinc-700 transition-colors"
          >
            <X size={11} />
          </button>
        </div>
        <div class="text-[10px] text-zinc-500 font-mono tabular-nums">
          {app.video.width}×{app.video.height}{app.video.codec
            ? ` · ${app.video.codec}`
            : ''}{app.video.duration
            ? ` · ${secToTimecode(app.video.duration)}`
            : ''}
        </div>
        {#if app.video.creationTime}
          <div
            class="text-[10px] text-zinc-600 font-mono truncate"
            title={app.video.creationTime}
          >
            recorded {app.video.creationTime}
          </div>
        {:else}
          <div class="text-[10px] text-zinc-600 leading-snug">
            No recording timestamp in container metadata — Phase 2 timeline
            alignment will need a manual offset.
          </div>
        {/if}
        <button
          onclick={() => app.pickAndLoadVideo()}
          class="h-6 px-2 rounded border border-zinc-700 bg-zinc-800/40
                 text-[11px] text-zinc-400 hover:text-zinc-200
                 hover:border-zinc-500 transition-colors"
          >Replace…</button
        >
      </div>
    {/if}
  </section>

  <ElementList />
</aside>
