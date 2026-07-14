<script>
  /**
   * ColorInput — color picker that supports scene color variable references.
   *
   * value      — hex color string (#rrggbb or #rrggbbaa) OR variable ref ($name)
   * vars       — scene.vars map: { name: "#hexcolor" }
   * onchange   — called with the new value string whenever the user changes it
   * placeholder — optional placeholder shown in the hex text field
   * class      — extra classes applied to the root div
   */
  import Input from './Input.svelte'
  import { cn } from '@/lib/utils.js'

  let {
    value = '#ffffff',
    vars = {},
    onchange,
    placeholder = '',
    class: className = '',
  } = $props()

  const varNames = $derived(Object.keys(vars))
  const isVar = $derived(typeof value === 'string' && value.startsWith('$'))

  // 6-digit hex to show in the color swatch (native picker & static tile)
  const swatchHex = $derived(() => {
    if (!value) return '#ffffff'
    if (typeof value === 'string' && value.startsWith('$')) {
      return (vars[value.slice(1)] ?? '#ffffff').slice(0, 7)
    }
    return String(value).slice(0, 7)
  })
</script>

<div class={cn('flex gap-2 items-center', className)}>
  {#if isVar}
    <!-- Static swatch showing the resolved variable color -->
    <div
      class="h-7 w-10 shrink-0 rounded border border-white/10 cursor-default"
      style="background:{swatchHex()}"
      title="Resolved from {value}"
    ></div>
  {:else}
    <!-- Native color picker (always 6-digit hex) -->
    <input
      type="color"
      value={swatchHex()}
      oninput={(e) => onchange?.(e.target.value)}
      class="h-7 w-10 shrink-0 rounded border border-white/10 bg-[var(--panel2)] cursor-pointer p-0.5"
    />
  {/if}

  {#if varNames.length > 0}
    <!-- Variable selector — only shown when scene has color vars -->
    <select
      value={isVar ? value : ''}
      onchange={(e) => {
        const v = e.target.value
        // Switching to "Custom" seeds the hex with the currently resolved color
        onchange?.(v === '' ? swatchHex() : v)
      }}
      class="shrink-0 h-7 rounded-[6px] border-0 bg-[var(--panel2)] pl-1.5 pr-1
             text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
      title="Pick a scene color variable"
    >
      <option value="">Custom</option>
      {#each varNames as name (name)}
        <option value="${name}">{name}</option>
      {/each}
    </select>
  {/if}

  {#if !isVar}
    <!-- Hex text field — hidden when a variable is active -->
    <Input
      value={String(value ?? '')}
      {placeholder}
      oninput={(e) => onchange?.(e.target.value)}
      class="flex-1 font-mono text-xs min-w-0"
    />
  {/if}
</div>
