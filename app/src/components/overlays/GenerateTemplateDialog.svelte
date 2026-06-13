<script>
  import { onMount, tick } from 'svelte'

  let { hasCurrentTemplate = false, ongenerate, oncancel } = $props()

  let prompt = $state('')
  // 'create' = brand-new template, 'edit' = modify the loaded one.
  let mode = $state('create')
  let loading = $state(false)
  let error = $state(null)
  let inputEl = $state(null)

  onMount(() => {
    window.addEventListener('keydown', onKeydown)
    tick().then(() => inputEl?.focus())
    return () => window.removeEventListener('keydown', onKeydown)
  })

  function onKeydown(e) {
    if (e.key === 'Escape' && !loading) {
      e.preventDefault()
      oncancel?.()
    }
    // Cmd/Ctrl+Enter submits from the textarea.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  async function handleSubmit() {
    const trimmed = prompt.trim()
    if (!trimmed || loading) return
    loading = true
    error = null
    try {
      await ongenerate?.(trimmed, { edit: mode === 'edit' && hasCurrentTemplate })
      // Parent closes the dialog on success.
    } catch (e) {
      error = e?.message ?? String(e)
      loading = false
    }
  }

  const examples = [
    'Minimal speed and power readout in the bottom-left corner',
    'A route map with a heart rate gauge and elevation plot',
    'Big crimson power meter on the right side',
  ]
</script>

<div
  role="dialog"
  aria-modal="true"
  aria-label="Generate template with AI"
  tabindex="-1"
  class="fixed inset-0 z-[70] flex items-center justify-center pt-14"
  onmousedown={(e) => {
    if (e.target === e.currentTarget && !loading) oncancel?.()
  }}
>
  <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>

  <div
    class="relative z-10 w-[460px] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl p-5"
  >
    <p class="text-sm font-semibold text-zinc-100">Generate template with AI</p>
    <p class="mt-1 text-xs text-zinc-500">
      Describe the overlay you want and we'll build it. Powered by OpenRouter.
    </p>

    {#if hasCurrentTemplate}
      <div class="mt-4 flex gap-1 rounded-[6px] border border-zinc-700 bg-zinc-800 p-0.5">
        <button
          type="button"
          onclick={() => (mode = 'create')}
          disabled={loading}
          class="flex-1 cursor-pointer rounded-[4px] px-3 py-1.5 text-xs transition-colors
                 {mode === 'create'
            ? 'bg-zinc-700 text-zinc-100'
            : 'text-zinc-400 hover:text-zinc-200'} disabled:opacity-50"
        >
          Create new
        </button>
        <button
          type="button"
          onclick={() => (mode = 'edit')}
          disabled={loading}
          class="flex-1 cursor-pointer rounded-[4px] px-3 py-1.5 text-xs transition-colors
                 {mode === 'edit'
            ? 'bg-zinc-700 text-zinc-100'
            : 'text-zinc-400 hover:text-zinc-200'} disabled:opacity-50"
        >
          Edit current
        </button>
      </div>
    {/if}

    <textarea
      bind:this={inputEl}
      bind:value={prompt}
      rows="4"
      disabled={loading}
      placeholder={mode === 'edit'
        ? 'e.g. add a cadence gauge in the top-right corner'
        : 'e.g. a clean speed and power overlay in the bottom-left corner'}
      class="mt-4 w-full resize-none rounded-[6px] border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 disabled:opacity-60"
    ></textarea>

    {#if mode === 'create'}
      <div class="mt-2 flex flex-wrap gap-1.5">
        {#each examples as ex (ex)}
          <button
            type="button"
            onclick={() => (prompt = ex)}
            disabled={loading}
            class="cursor-pointer rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-50"
          >
            {ex}
          </button>
        {/each}
      </div>
    {/if}

    {#if error}
      <p class="mt-3 text-xs text-red-400">{error}</p>
    {/if}

    <div class="mt-4 flex items-center justify-end gap-2">
      <button
        type="button"
        onclick={() => oncancel?.()}
        disabled={loading}
        class="cursor-pointer rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-400 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Cancel
      </button>
      <button
        type="button"
        onclick={handleSubmit}
        disabled={!prompt.trim() || loading}
        class="flex cursor-pointer items-center gap-1.5 rounded border border-[#7f0a22] bg-[#dc143c] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#c01236] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {#if loading}
          <span
            class="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white"
          ></span>
          Generating…
        {:else}
          Generate
        {/if}
      </button>
    </div>
  </div>
</div>
