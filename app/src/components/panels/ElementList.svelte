<script>
  import { getContext } from 'svelte'
  import {
    ArrowDown,
    ArrowUp,
    BarChart2,
    Gauge,
    Hash,
    Map,
    Thermometer,
    Trash2,
    Type,
  } from 'lucide-svelte'

  import { ADD_PRESETS, elementMeta } from '../../lib/elementTypes.js'

  const app = getContext('app')
  let draggingId = $state(null)
  let dropIndex = $state(null)
  let pointerDrag = $state(null)
  let suppressClickId = $state(null)

  const ICONS = { type: Type, hash: Hash, bar: BarChart2, map: Map, meter: Thermometer, gauge: Gauge }

  // Flat list of all elements in z-order (top of list = front-most).
  let elements = $derived(() => {
    if (!app.config?.elements) return []
    const byId = {}
    for (const el of app.config.elements) {
      const meta = elementMeta(el)
      byId[el.id] = {
        id: el.id,
        type: meta.kind,
        name: meta.name,
        unit: meta.unit,
      }
    }
    return [...(app.elementLayerOrder ?? [])]
      .reverse()
      .map((id) => byId[id])
      .filter(Boolean)
  })

  function addPreset(preset) {
    app.addElement(preset.type, preset.defaults(app.config?.scene))
  }

  function onRowPointerDown(e, id) {
    if (e.button !== 0 || e.target.closest('[data-layer-action]')) return
    pointerDrag = {
      id,
      pointerId: e.pointerId,
      startY: e.clientY,
      moved: false,
    }
    dropIndex = elements().findIndex((el) => el.id === id)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function updateDropIndex(clientY) {
    const rows = [...document.querySelectorAll('[data-element-row]')]
    if (rows.length === 0) return
    const next = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect()
      return clientY < rect.top + rect.height / 2
    })
    dropIndex = next === -1 ? rows.length : next
  }

  function onWindowPointerMove(e) {
    if (!pointerDrag) return
    const dy = Math.abs(e.clientY - pointerDrag.startY)
    if (!pointerDrag.moved && dy < 4) return
    pointerDrag = { ...pointerDrag, moved: true }
    draggingId = pointerDrag.id
    updateDropIndex(e.clientY)
    e.preventDefault()
  }

  function commitPointerDrop() {
    if (!pointerDrag?.moved || dropIndex == null) return
    const displayIds = elements().map((el) => el.id)
    const from = displayIds.indexOf(pointerDrag.id)
    if (from < 0) return
    const next = [...displayIds]
    const [moved] = next.splice(from, 1)
    const to = Math.max(
      0,
      Math.min(next.length, dropIndex - (from < dropIndex ? 1 : 0)),
    )
    next.splice(to, 0, moved)
    if (to !== from) app.setElementLayerOrder([...next].reverse())
    app.selectedElementId = pointerDrag.id
    suppressClickId = pointerDrag.id
  }

  function onWindowPointerUp() {
    if (!pointerDrag) return
    if (pointerDrag.moved) {
      commitPointerDrop()
    } else {
      app.selectedElementId =
        app.selectedElementId === pointerDrag.id ? null : pointerDrag.id
      suppressClickId = pointerDrag.id
    }
    pointerDrag = null
    draggingId = null
    dropIndex = null
  }

  function selectElement(id, selected) {
    if (suppressClickId === id) {
      suppressClickId = null
      return
    }
    app.selectedElementId = selected ? null : id
  }
</script>

<svelte:window
  onpointermove={onWindowPointerMove}
  onpointerup={onWindowPointerUp}
  onpointercancel={onWindowPointerUp}
/>

<section class="px-4 py-3 flex-1 overflow-y-auto">
  <div class="flex items-center justify-between mb-2">
    <p class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Elements</p>
    <div class="flex gap-0.5">
      {#each ADD_PRESETS as preset (preset.key)}
        {@const Icon = ICONS[preset.icon]}
        <button onclick={() => addPreset(preset)} title={preset.title} class="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
          <Icon size={13} />
        </button>
      {/each}
    </div>
  </div>

  {#if !app.config}
    <p class="text-xs text-zinc-600 italic">Load a template to see elements.</p>
  {:else if elements().length === 0}
    <p class="text-xs text-zinc-600 italic">No elements. Add one above.</p>
  {:else}
    <ul class="space-y-0.5 pb-3">
      {#each elements() as el, i (el.id)}
        {@const selected = app.selectedElementId === el.id}
        <li
          data-element-row
          onpointerdown={(e) => onRowPointerDown(e, el.id)}
          class={`relative group rounded-[6px]
            ${draggingId === el.id ? 'opacity-45' : ''}
            ${dropIndex === i && draggingId !== el.id ? 'before:absolute before:left-0 before:right-0 before:-top-0.5 before:h-px before:bg-primary' : ''}
            ${dropIndex === i + 1 && draggingId !== el.id ? 'after:absolute after:left-0 after:right-0 after:-bottom-0.5 after:h-px after:bg-primary' : ''}`}
        >
          <button
            onclick={() => selectElement(el.id, selected)}
            class={`w-full flex items-center gap-2 px-2.5 py-2 pr-20 rounded-[6px] text-left text-sm transition-colors
              cursor-grab active:cursor-grabbing
              ${selected
                ? 'bg-primary/10 text-primary border border-primary/30'
                : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100'}`}
          >
            {#if el.type === 'label'}
              <Type size={12} class="shrink-0 opacity-60" />
            {:else if el.type === 'value'}
              <Hash size={12} class="shrink-0 opacity-60" />
            {:else if el.type === 'map'}
              <Map size={12} class="shrink-0 opacity-60" />
            {:else if el.type === 'meter'}
              <Thermometer size={12} class="shrink-0 opacity-60" />
            {:else if el.type === 'gauge'}
              <Gauge size={12} class="shrink-0 opacity-60" />
            {:else}
              <BarChart2 size={12} class="shrink-0 opacity-60" />
            {/if}
            <span class="truncate font-mono text-xs">{el.name}</span>
            {#if el.unit}
              <span class="shrink-0 text-[9px] font-medium px-1 py-0.5 rounded bg-zinc-700/60 text-zinc-400 uppercase tracking-wide">{el.unit === 'imperial' ? 'imp' : el.unit}</span>
            {/if}
          </button>
          <div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              data-layer-action
              onclick={(e) => { e.stopPropagation(); app.moveElementLayer(el.id, 1) }}
              class="p-1 rounded text-zinc-600 hover:text-zinc-200 transition-colors"
              title="Bring forward"
              tabindex="-1"
            >
              <ArrowUp size={11} />
            </button>
            <button
              data-layer-action
              onclick={(e) => { e.stopPropagation(); app.moveElementLayer(el.id, -1) }}
              class="p-1 rounded text-zinc-600 hover:text-zinc-200 transition-colors"
              title="Send backward"
              tabindex="-1"
            >
              <ArrowDown size={11} />
            </button>
            <button
              data-layer-action
              onclick={(e) => { e.stopPropagation(); app.removeElement(el.id) }}
              class="p-1 rounded text-zinc-600 hover:text-destructive transition-colors"
              title="Remove"
              tabindex="-1"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
