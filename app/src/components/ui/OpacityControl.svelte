<script>
  import { getContext } from 'svelte'
  import { cn } from '@/lib/utils.js'
  import Input from './Input.svelte'

  let {
    value = 1,
    min = 0,
    max = 1,
    step = 0.05,
    class: className = '',
    oninput,
  } = $props()

  const app = getContext('app')
  // Writable $derived: tracks the `value` prop but can be reassigned locally
  // for in-flight slider/number-input edits before `oninput` is committed.
  let currentValue = $derived(value ?? 1)

  function emit(value) {
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
    accent-color: var(--primary);
  }
</style>
