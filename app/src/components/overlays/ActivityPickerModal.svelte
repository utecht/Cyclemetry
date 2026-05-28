<script>
  import { getContext, onMount } from 'svelte'
  import { open } from '@tauri-apps/plugin-dialog'
  import * as backend from '@/api/backend.js'
  import { X, Trash2, FolderOpen, Activity } from 'lucide-svelte'

  const app = getContext('app')
  let { onload, onclose } = $props()

  let saved = $state([])
  let loading = $state(true)
  let loadError = $state(null)
  let deleting = $state([])
  let opening = $state(false)
  let showStravaDialog = $state(false)

  onMount(() => {
    window.addEventListener('keydown', onKeydown)
    refresh()
    return () => window.removeEventListener('keydown', onKeydown)
  })

  function onKeydown(e) {
    if (e.key === 'Escape') {
      if (showStravaDialog) {
        showStravaDialog = false
        return
      }
      onclose()
    }
  }

  async function refresh() {
    loading = true
    try {
      saved = await backend.listActivities()
    } catch (e) {
      loadError = e?.message ?? String(e)
    } finally {
      loading = false
    }
  }

  function isActive(filename) {
    return app.gpxFilename === filename
  }

  function formatStart(ms) {
    if (!ms) return ''
    const d = new Date(ms)
    const now = new Date()
    return d.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    })
  }

  function displayName(filename) {
    // Strip the extension only; keep dots that are part of the name (e.g. "2024.05.20.gpx").
    return filename.replace(/\.[^.]+$/, '')
  }

  async function handleChooseFromDisk() {
    opening = true
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Activity (GPX, FIT, TCX)', extensions: ['gpx', 'fit', 'tcx'] }],
        title: 'Select Activity File',
      })
      if (!selected) return
      await onload(selected)
      onclose()
    } catch (e) {
      app.errorMessage = `Activity load failed: ${e?.message ?? e}`
    } finally {
      opening = false
    }
  }

  async function handleLoadSaved(filename) {
    if (isActive(filename)) {
      onclose()
      return
    }
    try {
      await onload({ savedFilename: filename })
      onclose()
    } catch (e) {
      app.errorMessage = `Could not open ${filename}: ${e?.message ?? e}`
    }
  }

  async function handleDelete(filename) {
    deleting = [...deleting, filename]
    try {
      await backend.deleteActivity(filename)
      if (app.gpxFilename === filename) {
        // Activity no longer exists — clear it so the UI doesn't show a stale label.
        app.gpxFilename = null
      }
      await refresh()
    } catch (e) {
      app.errorMessage = `Delete failed: ${e?.message ?? e}`
    } finally {
      deleting = deleting.filter((x) => x !== filename)
    }
  }
</script>

<div
  role="dialog"
  aria-modal="true"
  aria-label="Choose Activity"
  tabindex="-1"
  class="fixed inset-0 z-50 flex items-center justify-center"
>
  <button
    type="button"
    class="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
    aria-label="Close activity picker"
    onclick={onclose}
  ></button>

  <div class="relative z-10 w-[720px] max-h-[80vh] flex flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">

    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
      <h2 class="text-sm font-semibold text-zinc-100">Choose Activity</h2>
      <div class="flex items-center gap-2">
        <button
          onclick={() => (showStravaDialog = true)}
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-zinc-700 bg-zinc-900/70 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-100"
        >
          <Activity size={12} />
          Connect to Strava
        </button>
        <button
          onclick={handleChooseFromDisk}
          disabled={opening}
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-primary/70 bg-primary/15 px-2.5 py-1.5 text-xs font-medium text-zinc-100 transition-colors hover:border-primary hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FolderOpen size={12} />
          {opening ? 'Opening…' : 'Choose from disk'}
        </button>
        <button
          onclick={onclose}
          class="cursor-pointer text-zinc-500 hover:text-zinc-200 transition-colors rounded-md p-0.5"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>

    <!-- Scrollable body -->
    <div class="overflow-y-auto flex-1 px-5 py-4 space-y-6">

      <div>
        <p class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">Recent</p>

        {#if loading}
          <div class="grid grid-cols-2 gap-2">
            {#each [1, 2, 3, 4] as i (i)}
              <div class="h-14 rounded-lg border border-zinc-800 bg-zinc-800/30 animate-pulse"></div>
            {/each}
          </div>
        {:else if loadError}
          <p class="text-xs text-red-400">{loadError}</p>
        {:else if saved.length === 0}
          <p class="text-xs text-zinc-500">No activities yet. Choose one from disk to get started.</p>
        {:else}
          <div class="grid grid-cols-2 gap-2">
            {#each saved as a (a.filename)}
              {@const active = isActive(a.filename)}
              {@const busy = deleting.includes(a.filename)}
              <div
                class="rounded-lg border overflow-hidden transition-colors flex items-center
                       {active
                         ? 'border-primary bg-zinc-800'
                         : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-500 hover:bg-zinc-800/80'}"
              >
                <button
                  onclick={() => handleLoadSaved(a.filename)}
                  class="flex-1 min-w-0 text-left px-3 py-2.5 cursor-pointer"
                >
                  <span class="text-xs font-medium text-zinc-100 truncate block">{displayName(a.filename)}</span>
                  <span class="text-[10px] text-zinc-500 truncate block mt-0.5">{formatStart(a.start_ms)}</span>
                </button>

                <button
                  onclick={() => handleDelete(a.filename)}
                  disabled={busy}
                  class="shrink-0 cursor-pointer p-2 mr-1 rounded text-zinc-500 hover:text-red-400 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  title="Remove from list"
                >
                  {#if busy}
                    <span class="text-[10px]">…</span>
                  {:else}
                    <Trash2 size={13} />
                  {/if}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

    </div>
  </div>
</div>

{#if showStravaDialog}
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Strava import coming soon"
    tabindex="-1"
    class="fixed inset-0 z-[60] flex items-center justify-center"
    onmousedown={(e) => { if (e.target === e.currentTarget) showStravaDialog = false }}
  >
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
    <div class="relative z-10 w-[380px] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl p-5">
      <p class="text-sm font-semibold text-zinc-100">Strava import is coming soon</p>
      <p class="mt-2 text-xs text-zinc-400 leading-relaxed">
        Direct Strava connection is still under development. For now, export your ride from Strava as a GPX file and load it from disk.
      </p>
      <div class="mt-5 flex justify-end">
        <button
          onclick={() => (showStravaDialog = false)}
          class="cursor-pointer text-xs px-3 py-1.5 rounded border border-zinc-600 text-zinc-200
                 hover:border-zinc-400 hover:text-zinc-100 transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  </div>
{/if}
