<script>
  import { getContext } from 'svelte'
  import { cn } from '@/lib/utils.js'
  import Input from './Input.svelte'

  let {
    value = 1,
    min = 0,
    max = 1,
    step = 0.01,
    class: className = '',
    oninput,
  } = $props()

  const app = getContext('app')
  // Writable $derived: tracks the `value` prop but can be reassigned locally
  // for in-flight slider/number-input edits before `oninput` is committed.
  let currentValue = $derived(value ?? 1)

  // Filled-track percentage. Drives a CSS variable on the input so the
  // custom track gradient knows where to switch from crimson → zinc, giving
  // pixel-perfect color control instead of relying on the browser's
  // accent-color (which Chromium desaturates).
  let pct = $derived.by(() => {
    const span = max - min
    if (!(span > 0)) return 0
    return Math.max(0, Math.min(100, ((currentValue - min) / span) * 100))
  })

  function emit(raw) {
    const value = Math.max(min, Math.min(max, parseFloat(raw) || 0))
    currentValue = value
    oninput?.({ target: { value } })
  }

  function beginRangeEdit() {
    app?.beginEditBatch?.()
  }

  function endRangeEdit() {
    app?.endEditBatch?.()
  }
</script>

<div class={cn('flex items-center gap-2', className)}>
  <input
    type="range"
    bind:value={currentValue}
    {min}
    {max}
    {step}
    style={`--pct: ${pct}%`}
    onpointerdown={beginRangeEdit}
    onpointerup={endRangeEdit}
    onpointercancel={endRangeEdit}
    onkeydown={(e) => {
      if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') beginRangeEdit()
    }}
    onkeyup={endRangeEdit}
    oninput={(e) => emit(e.target.value)}
    class="opacity-slider h-7 min-w-0 flex-1"
  />
  <Input
    type="number"
    value={currentValue}
    {min}
    {max}
    {step}
    oninput={(e) => emit(e.target.value)}
    class="w-16 px-2 text-right tabular-nums"
  />
</div>

<style>
  .opacity-slider {
    appearance: none;
    background: transparent;
    cursor: pointer;
  }
  .opacity-slider:focus {
    outline: none;
  }
  .opacity-slider::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 9999px;
    background: linear-gradient(
      to right,
      var(--primary) calc(var(--pct, 0%)),
      #3f3f46 calc(var(--pct, 0%))
    );
  }
  .opacity-slider::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--primary);
    margin-top: -4px;
    cursor: pointer;
  }
</style>
