import { memo, useCallback } from 'react';
import { useRecoilState } from 'recoil';
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
 * - Clicking "Chat" sets the conversation endpoint to the first available
 *   `custom` endpoint (e.g., OpenCodez).
 * - The actual agent selection (for Agent Mode) happens automatically via
 *   `buildDefaultConvo` + `useGetDefaultAgentQuery` in `useNewConvo`.
 * - For USER role: the backend enforces that only the default agent is used
 *   (`canAccessAgentFromBody` middleware), so even if a USER switches to
 *   Agent Mode they get the default agent automatically.
 *
 * NOTE: This component does NOT show agent names, provider names, or model
 * names. That information is intentionally hidden to simplify the UX and
 * enforce the "one default agent" model of Ai Norx.
 */

type Mode = 'agent' | 'chat';

function ModeSwitcherImpl() {
  const localize = useLocalize();
  const [endpoint, setEndpoint] = useRecoilState(store.conversationEndpointByIndex(0));

  const mode: Mode = endpoint === EModelEndpoint.agents ? 'agent' : 'chat';

  const handleSwitch = useCallback(
    (newMode: Mode) => {
      if (newMode === mode) {
        return;
      }
      const newEndpoint =
        newMode === 'agent' ? EModelEndpoint.agents : EModelEndpoint.custom;
      setEndpoint(newEndpoint);
      // The downstream effect of changing the endpoint atom is handled by
      // `useNewConvo` → `buildDefaultConvo` which will pick the right agent
      // or model based on the new endpoint.
    },
    [mode, setEndpoint],
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
