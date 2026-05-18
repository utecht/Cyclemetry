<script>
  import { getContext } from 'svelte'
  import ElementProperties from '../panels/ElementProperties.svelte'

  const app = getContext('app')
</script>

<aside class="w-[272px] shrink-0 border-l border-zinc-800 bg-zinc-900/30 overflow-hidden flex flex-col">
  {#if app.selectedElementId}
    <div class="px-4 py-3 border-b border-zinc-800">
      <p class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Properties</p>
    </div>
  {/if}
  <ElementProperties />
</aside>
