<script>
  import { getContext, onMount } from 'svelte'
  import { X } from 'lucide-svelte'
  import { formatHomePath } from '../../lib/utils.js'

  const app = getContext('app')

  let { onclose } = $props()

  const PREVIEW_FPS_OPTIONS = [1, 5, 10, 15, 30]

  let effectiveOutputDir = $derived(app.effectiveOutputDir)
  let outputDirLabel = $derived(formatHomePath(effectiveOutputDir))

  function onKeydown(e) {
    if (e.key === 'Escape') onclose()
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  })
</script>

<!-- Backdrop -->
<div
  role="dialog"
  aria-modal="true"
  aria-label="Settings"
  tabindex="-1"
  class="fixed inset-0 z-50 flex items-center justify-center"
>
  <div role="presentation" class="absolute inset-0 bg-black/60 backdrop-blur-sm" onmousedown={onclose}></div>

  <!-- Panel -->
  <div
    class="relative z-10 w-[480px] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
  >
    <!-- Header -->
    <div
      class="flex items-center justify-between px-5 py-4 border-b border-zinc-800"
    >
      <h2 class="text-sm font-semibold text-zinc-100">Settings</h2>
      <button
        onclick={onclose}
        class="cursor-pointer text-zinc-500 hover:text-zinc-200 transition-colors rounded-md p-0.5"
        aria-label="Close"
      >
        <X size={16} />
      </button>
    </div>

    <!-- Body -->
    <div class="px-5 py-4 space-y-6">
      <!-- Output folder -->
      <div class="space-y-2">
        <p
          class="text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
        >
          Output Folder
        </p>
        <p class="text-[11px] text-zinc-500">
          Where generated overlays are saved.
        </p>
        <div
          class="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2"
        >
          <span
            class="flex-1 text-xs text-zinc-300 font-mono truncate"
            title={effectiveOutputDir}
          >
            {outputDirLabel}
          </span>
          <button
            onclick={() =>
              app.pickOutputDir().catch((e) => {
                app.errorMessage = e?.message ?? String(e)
              })}
            class="cursor-pointer shrink-0 text-[11px] text-zinc-400 hover:text-zinc-100 border border-zinc-600 hover:border-zinc-400 rounded px-2.5 py-1 transition-colors"
            >Browse…</button
          >
          {#if app.outputDir}
            <button
              onclick={() => app.resetOutputDir()}
              class="cursor-pointer shrink-0 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >Reset</button
            >
          {/if}
        </div>
      </div>

      <!-- Preview FPS -->
      <div class="space-y-2">
        <p
          class="text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
        >
          Preview Frame Rate
        </p>
        <p class="text-[11px] text-zinc-500">
          Frames per second used when scrubbing the playback timeline.
        </p>
        <div class="flex gap-1.5">
          {#each PREVIEW_FPS_OPTIONS as fps (fps)}
            {@const active = app.previewFps === fps}
            <button
              onclick={() => {
                app.previewFps = fps
              }}
              class="cursor-pointer flex-1 rounded-lg border py-2 text-xs font-medium transition-colors
                {active
                ? 'border-zinc-400 text-zinc-100 bg-zinc-700'
                : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'}"
            >
              {fps} fps
            </button>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
