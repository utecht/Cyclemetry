<script>
  import { getContext } from 'svelte'
  import ElementProperties from '../panels/ElementProperties.svelte'
  import AiChatPanel from '../panels/AiChatPanel.svelte'

  let { aiChatOpen = false, aiAssistantEnabled = true } = $props()

  const app = getContext('app')
</script>

<aside
  class="shrink-0 bg-[var(--panel)] rounded-[10px] overflow-hidden flex flex-col transition-[width] duration-150
         {aiChatOpen ? 'w-[320px]' : 'w-[292px]'}"
>
  {#if aiAssistantEnabled}
    <!-- AI chat panel — always mounted so message history persists across element-click switches -->
    <div class="flex flex-col flex-1 min-h-0" class:hidden={!aiChatOpen}>
      <AiChatPanel />
    </div>
  {/if}

  <!-- Properties panel — shown when AI chat is closed and something is selected.
       The panel leads with ElementProperties' own element-type header, so no
       separate "Properties" chrome row is needed. -->
  {#if !aiChatOpen}
    {#if app.selectedElementId || app.selectedGroupId}
      <ElementProperties />
    {/if}
  {/if}
</aside>
