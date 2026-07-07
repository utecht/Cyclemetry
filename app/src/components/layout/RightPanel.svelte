<script>
  import { getContext } from 'svelte'
  import { Sparkles } from 'lucide-svelte'
  import ElementProperties from '../panels/ElementProperties.svelte'
  import AiChatPanel from '../panels/AiChatPanel.svelte'

  let { aiChatOpen = false, onreopenAiChat, aiAssistantEnabled = true } = $props()

  const app = getContext('app')
</script>

<aside
  class="shrink-0 border-l border-zinc-800 bg-zinc-900/30 overflow-hidden flex flex-col transition-[width] duration-150
         {aiChatOpen ? 'w-[320px]' : 'w-[272px]'}"
>
  {#if aiAssistantEnabled}
    <!-- AI chat panel — always mounted so message history persists across element-click switches -->
    <div class="flex flex-col flex-1 min-h-0" class:hidden={!aiChatOpen}>
      <AiChatPanel />
    </div>
  {/if}

  <!-- Properties panel — shown when AI chat is closed and something is selected -->
  {#if !aiChatOpen}
    {#if app.selectedElementId || app.selectedGroupId}
      <div class="px-4 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Properties</p>
        {#if aiAssistantEnabled}
          <button
            onclick={onreopenAiChat}
            title="Open AI assistant"
            class="cursor-pointer h-5 w-5 flex items-center justify-center rounded text-zinc-600
                 hover:text-[#dc143c] hover:bg-zinc-800 transition-colors"
          >
            <Sparkles size={11} />
          </button>
        {/if}
      </div>
      <ElementProperties />
    {/if}
  {/if}
</aside>
