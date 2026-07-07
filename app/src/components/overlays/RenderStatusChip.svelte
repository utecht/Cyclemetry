<script>
  import { getContext } from 'svelte'
  import { formatTime } from '@/lib/utils.js'

  // Compact render-status chip that lives in the header next to the Render
  // button while a render runs in the background. Click to open the full
  // progress dialog (the only place to cancel); the render keeps going either way.
  let { onexpand } = $props()

  const app = getContext('app')

  let p = $derived(app.renderProgress)
  let pct = $derived(p.total > 0 ? Math.round((p.current / p.total) * 100) : 0)
  let finalizing = $derived(pct >= 100)
  let estimating = $derived(
    !finalizing &&
      p.status === 'rendering' &&
      p.estimatedSecondsRemaining == null,
  )

  // Progress-ring geometry.
  const R = 9
  const CIRC = 2 * Math.PI * R
  let dashOffset = $derived(CIRC * (1 - Math.min(pct, 100) / 100))

  let detail = $derived(
    finalizing
      ? 'Encoding output file…'
      : estimating
        ? 'Estimating time remaining…'
        : p.estimatedSecondsRemaining != null
          ? `${formatTime(p.estimatedSecondsRemaining)} remaining`
          : `${formatTime(p.overlaySecondsRendered)} / ${formatTime(p.overlayTotalSeconds)} rendered`,
  )
</script>

<button
  type="button"
  title={`${finalizing ? 'Finalizing' : `Rendering — ${pct}%`} · ${detail}\nClick for details`}
  onclick={onexpand}
  class="flex items-center h-7 rounded-[6px] border border-primary/40 bg-primary/10 px-2 gap-1.5 hover:border-primary/70 hover:bg-primary/15 transition-colors cursor-pointer"
>
  <!-- Progress ring -->
  <span class="relative grid h-4 w-4 place-items-center">
    <svg class="h-4 w-4 -rotate-90" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r={R} fill="none" stroke="currentColor" stroke-width="3" class="text-primary/25" />
      {#if finalizing}
        <circle cx="12" cy="12" r={R} fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="text-primary origin-center animate-spin" stroke-dasharray={`${CIRC * 0.25} ${CIRC}`} />
      {:else}
        <circle cx="12" cy="12" r={R} fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="text-primary transition-all duration-300" stroke-dasharray={CIRC} stroke-dashoffset={dashOffset} />
      {/if}
    </svg>
  </span>
  <span class="text-xs font-medium text-zinc-100 tabular-nums">
    {finalizing ? 'Finalizing…' : `Rendering ${pct}%`}
  </span>
</button>
