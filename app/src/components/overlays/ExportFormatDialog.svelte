<script>
  import { onMount } from 'svelte'

  let {
    // [{ value, label, container, transparent, desc }] — available export formats.
    formats = [],
    // Preselected format (last used, persisted)
    initial = 'prores',
    // (format) => "~1:20" | null — estimated render wall-clock time
    timeFor = null,
    // (format) => "~1.5 GB" | null — estimated output file size
    sizeFor = null,
    // (format) => boolean — true when the codec has no same-machine
    // measurement yet, so it offers a quick test render
    testAvailableFor = null,
    // Format currently being measured by the test render, or null
    calibrating = null,
    // (format) => void — run the quick test render for a codec
    oncalibrate = null,
    onconfirm,
    oncancel,
  } = $props()

  let selected = $state(initial)
  let selectedFormat = $derived(formats.find((f) => f.value === selected))

  // Shared column layout so the header cells and every row align.
  const COLS =
    'grid grid-cols-[1fr_6rem_5rem_4.5rem_5rem] items-center gap-2'

  onMount(() => {
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  })

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      oncancel?.()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!calibrating) onconfirm?.(selected)
    }
  }
</script>

<div
  role="dialog"
  aria-modal="true"
  aria-label="Choose export format"
  tabindex="-1"
  class="fixed inset-0 z-[60] flex items-center justify-center pt-14"
  onmousedown={(e) => {
    if (e.target === e.currentTarget) oncancel?.()
  }}
>
  <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>

  <div
    class="relative z-10 w-[600px] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl p-5"
  >
    <p class="text-base font-semibold text-zinc-100">Select export format</p>

    <!-- Comparison table: transparency, render time, and file size side by
         side so the formats are easy to weigh against each other. -->
    <div
      class="mt-3 rounded-[6px] border border-zinc-700 overflow-hidden"
      role="radiogroup"
      aria-label="Export format"
    >
      <div
        class="{COLS} px-3 py-2 bg-zinc-800/60 border-b border-zinc-700
               text-xs font-medium uppercase tracking-wide text-zinc-500"
      >
        <span>Format</span>
        <span>Best for</span>
        <span class="text-center">Transparent</span>
        <span class="text-right">Est. time</span>
        <span class="text-right">Est. size</span>
      </div>

      {#each formats as f, i (f.value)}
        {@const active = selected === f.value}
        {@const time = timeFor?.(f.value) ?? null}
        {@const size = sizeFor?.(f.value) ?? null}
        {@const measuring = calibrating === f.value}
        {@const needsTest =
          time == null && size == null && testAvailableFor?.(f.value)}
        <div
          role="radio"
          aria-checked={active}
          tabindex="0"
          onclick={() => (selected = f.value)}
          onkeydown={(e) => {
            if (e.key === ' ') {
              e.preventDefault()
              selected = f.value
            }
          }}
          class="{COLS} px-3 py-2.5 cursor-pointer transition-colors {i > 0
            ? 'border-t border-zinc-800'
            : ''} {active
            ? 'bg-primary/10'
            : 'bg-zinc-800/20 hover:bg-zinc-800/50'}"
        >
          <span class="flex items-baseline gap-1.5 min-w-0">
            <span
              class="truncate text-xs font-medium {active
                ? 'text-zinc-50'
                : 'text-zinc-200'}">{f.label}</span
            >
            {#if f.container}
              <span class="shrink-0 font-mono text-xs text-zinc-600"
                >{f.container}</span
              >
            {/if}
          </span>

          <span
            class="truncate text-xs {active
              ? 'text-zinc-300'
              : 'text-zinc-400'}">{f.bestFor ?? ''}</span
          >

          <span
            class="text-center font-mono text-xs {f.transparent
              ? active
                ? 'text-zinc-300'
                : 'text-zinc-500'
              : 'text-zinc-600'}">{f.transparent ? 'Yes' : 'No'}</span
          >

          {#if measuring}
            <span
              class="col-span-2 text-right font-mono text-xs text-zinc-400 animate-pulse"
              >Testing…</span
            >
          {:else if needsTest}
            {#if calibrating}
              <span
                class="col-span-2 text-right font-mono text-xs text-zinc-500"
                >Queued…</span
              >
            {:else}
              <button
                type="button"
                onclick={(e) => {
                  e.stopPropagation()
                  oncalibrate?.(f.value)
                }}
                class="col-span-2 text-right font-mono text-xs text-zinc-400
                       underline decoration-zinc-600 underline-offset-2
                       hover:text-zinc-200 cursor-pointer transition-colors"
              >
                Test render →
              </button>
            {/if}
          {:else}
            <span
              class="text-right font-mono text-xs tabular-nums {active
                ? 'text-zinc-200'
                : 'text-zinc-400'}">{time ?? '—'}</span
            >
            <span
              class="text-right font-mono text-xs tabular-nums {active
                ? 'text-zinc-200'
                : 'text-zinc-400'}">{size ?? '—'}</span
            >
          {/if}
        </div>
      {/each}
    </div>

    <!-- Detail for the selected format — keeps the table rows scannable while
         still explaining what the choice means. -->
    {#if selectedFormat?.desc}
      <p class="mt-3 text-sm leading-relaxed text-zinc-400">
        {selectedFormat.desc}
      </p>
    {/if}

    <div class="mt-4 flex justify-end gap-2">
      <button
        onclick={() => oncancel?.()}
        class="text-xs px-3 py-1.5 rounded border border-zinc-600 text-zinc-300
               hover:border-zinc-400 hover:text-zinc-100 cursor-pointer transition-colors"
      >
        Cancel
      </button>
      <button
        onclick={() => onconfirm?.(selected)}
        disabled={!!calibrating}
        title={calibrating ? 'Waiting for the test render to finish' : null}
        class="text-xs px-3 py-1.5 rounded border border-primary/70 bg-primary/15 text-zinc-100
               hover:border-primary hover:bg-primary/25 cursor-pointer transition-colors
               disabled:opacity-50 disabled:cursor-default"
      >
        Render
      </button>
    </div>
  </div>
</div>
