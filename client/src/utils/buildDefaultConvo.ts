import {
  parseConvo,
  EModelEndpoint,
  SystemRoles,
  isAgentsEndpoint,
  isEphemeralAgentId,
  isAssistantsEndpoint,
} from 'librechat-data-provider';
import type { TConversation, EndpointSchemaKey } from 'librechat-data-provider';
import { clearModelForNonEphemeralAgent } from './endpoints';
import { getLocalStorageItems } from './localStorage';

/**
 * Legacy fallback — used ONLY when no default agent is configured in DB.
 * The new system queries /api/agents/default to determine which agent to use
 * for new conversations in Agent Mode. This constant is kept for backward
 * compatibility with existing conversations that may still reference it.
 */
const LEGACY_PRIMARY_AGENT_ID = 'agent_primary';

const buildDefaultConvo = ({
  models,
  conversation,
  endpoint = null,
  lastConversationSetup,
  defaultParamsEndpoint,
  userRole,
  defaultAgentId,
}: {
  models: string[];
  conversation: TConversation;
  endpoint?: EModelEndpoint | null;
  lastConversationSetup: TConversation | null;
  defaultParamsEndpoint?: string | null;
  /** Optional: role of the current user. When USER, forces default agent. */
  userRole?: string;
  /** Optional: ID of the agent marked as default (from /api/agents/default).
   *  Falls back to legacy 'agent_primary' if not provided. */
  defaultAgentId?: string | null;
}): TConversation => {
  const { lastSelectedModel, lastSelectedTools } = getLocalStorageItems();
  const endpointType = lastConversationSetup?.endpointType ?? conversation.endpointType;

  if (!endpoint) {
    return {
      ...conversation,
      endpointType,
      endpoint,
    };
  }

  const availableModels = models;
  const model = lastConversationSetup?.model ?? lastSelectedModel?.[endpoint] ?? '';

  let possibleModels: string[];

  if (availableModels.includes(model)) {
    possibleModels = [model, ...availableModels];
  } else {
    possibleModels = [...availableModels];
  }

  const convo = parseConvo({
    endpoint: endpoint as EndpointSchemaKey,
    endpointType: endpointType as EndpointSchemaKey,
    conversation: lastConversationSetup,
    possibleValues: {
      models: possibleModels,
    },
    defaultParamsEndpoint,
  });

  const defaultConvo = {
    ...conversation,
    ...convo,
    endpointType,
    endpoint,
  };

  // Ensures assistant_id is always defined
  const assistantId = convo?.assistant_id ?? conversation?.assistant_id ?? '';
  const defaultAssistantId = lastConversationSetup?.assistant_id ?? '';
  if (isAssistantsEndpoint(endpoint) && !defaultAssistantId && assistantId) {
    defaultConvo.assistant_id = assistantId;
  }

  // Ensures agent_id is always defined
  const agentId = convo?.agent_id ?? '';
  const lastAgentId = lastConversationSetup?.agent_id ?? '';
  if (
    isAgentsEndpoint(endpoint) &&
    agentId &&
    (!lastAgentId || isEphemeralAgentId(lastAgentId))
  ) {
    defaultConvo.agent_id = agentId;
  }

  // ── Default-Agent policy ───────────────────────────────────────────
  // Both USER and ADMIN start new conversations on the agents endpoint with
  // the default agent (DB-driven via /api/agents/default).
  // The ModeSwitcher in the Header no longer exposes agent selection — both
  // roles get the default agent automatically.
  // The model field for agents endpoint = agent_id (LibreChat convention).
  if (isAgentsEndpoint(endpoint)) {
    // If the caller already provided an agent_id (e.g., editing an existing
    // conversation or selecting from a saved preset), keep it.
    const existingAgentId = defaultConvo.agent_id ?? agentId ?? null;
    const isEphemeral = isEphemeralAgentId(existingAgentId ?? '');

    // Use the default agent from DB if no specific agent is set, or if the
    // existing agent is ephemeral (temporary).
    if (!existingAgentId || isEphemeral) {
      const effectiveAgentId = defaultAgentId ?? LEGACY_PRIMARY_AGENT_ID;
      defaultConvo.agent_id = effectiveAgentId;
      defaultConvo.model = effectiveAgentId;
    } else {
      // Keep the existing non-ephemeral agent_id and ensure model matches
      defaultConvo.model = existingAgentId;
    }

    // For USER role, tools cannot be toggled — they use the agent's tools.
    // For ADMIN role, allow last-selected tools to persist.
    if (userRole === SystemRoles.USER) {
      defaultConvo.tools = undefined;
    } else {
      defaultConvo.tools = lastConversationSetup?.tools ?? lastSelectedTools ?? defaultConvo.tools;
    }
  } else {
    // Non-agents endpoint (e.g., custom for Chat mode)
    clearModelForNonEphemeralAgent(defaultConvo);
    defaultConvo.tools = lastConversationSetup?.tools ?? lastSelectedTools ?? defaultConvo.tools;
  }

  return defaultConvo;
};

export default buildDefaultConvo;
