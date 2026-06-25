import { memo, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { Bot, MessageSquare } from 'lucide-react';
import { EModelEndpoint } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

/**
 * ModeSwitcher — the new top-bar conversation mode switcher.
 *
 * Replaces the old `<ModelSelector>` for ADMIN and the static "Ai Norx" pill
 * for USER. Both roles now see the same UI: two buttons, Agent Mode | Chat.
 *
 * Behavior:
 * - Clicking "Agent Mode" sets the conversation endpoint to `agents`.
 * - Clicking "Chat" sets the conversation endpoint to `custom`.
 * - The actual agent/model selection happens automatically via `useNewConvo`
 *   + `buildDefaultConvo` which watches the conversation endpoint atom.
 *
 * Implementation note: `conversationEndpointByIndex` is a read-only selector.
 * To change the endpoint we use `useNewConvo().newConversation({ template })`
 * which rebuilds the conversation with the new endpoint via `buildDefaultConvo`.
 *
 * NOTE: This component does NOT show agent names, provider names, or model
 * names. That information is intentionally hidden to simplify the UX and
 * enforce the "one default agent" model of Ai Norx.
 */

type Mode = 'agent' | 'chat';

function ModeSwitcherImpl() {
  const localize = useLocalize();
  const endpoint = useRecoilValue(store.conversationEndpointByIndex(0));

  const mode: Mode = endpoint === EModelEndpoint.agents ? 'agent' : 'chat';

  const handleSwitch = useCallback(
    (newMode: Mode) => {
      if (newMode === mode) {
        return;
      }
      // We don't mutate Recoil directly — instead we dispatch a navigation
      // to /c/new with the desired endpoint as a query param. The
      // `useNewConvo` hook picks it up and rebuilds the conversation.
      const newEndpoint =
        newMode === 'agent' ? EModelEndpoint.agents : EModelEndpoint.custom;
      const url = new URL(window.location.href);
      url.pathname = '/c/new';
      url.searchParams.set('endpoint', newEndpoint);
      url.searchParams.set('ref', 'mode-switcher');
      window.history.pushState({}, '', url.toString());
      // Force a reload so useNewConvo picks up the new endpoint param.
      // This is the simplest, most reliable way to switch modes — it reuses
      // all the existing conversation-setup logic in useNewConvo.
      window.location.reload();
    },
    [mode],
  );

  const agentModeLabel = localize('com_ui_agent_mode') || 'وضع المساعد';
  const chatModeLabel = localize('com_ui_chat_mode') || 'دردشة';

  return (
    <div
      className="my-1 flex h-9 w-full max-w-[280px] items-center gap-1 rounded-xl border border-border-light bg-surface-secondary p-1"
      role="tablist"
      aria-label={localize('com_ui_conversation_mode') || 'وضع المحادثة'}
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'agent'}
        onClick={() => handleSwitch('agent')}
        className={cn(
          'flex h-7 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-all',
          mode === 'agent'
            ? 'bg-primary text-white shadow-sm'
            : 'text-text-secondary hover:bg-surface-tertiary hover:text-text-primary',
        )}
        data-testid="mode-switcher-agent"
      >
        <Bot className="h-4 w-4" aria-hidden="true" />
        <span className="truncate">{agentModeLabel}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'chat'}
        onClick={() => handleSwitch('chat')}
        className={cn(
          'flex h-7 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-all',
          mode === 'chat'
            ? 'bg-primary text-white shadow-sm'
            : 'text-text-secondary hover:bg-surface-tertiary hover:text-text-primary',
        )}
        data-testid="mode-switcher-chat"
      >
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
        <span className="truncate">{chatModeLabel}</span>
      </button>
    </div>
  );
}

const ModeSwitcher = memo(ModeSwitcherImpl);
ModeSwitcher.displayName = 'ModeSwitcher';

export default ModeSwitcher;
