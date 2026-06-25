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
  // USER role always uses the default agent on the agents endpoint.
  // The default agent ID comes from /api/agents/default (DB-driven).
  // ADMIN role can use any agent they pick — they are NOT forced to the default.
  // The model field for agents endpoint = agent_id (LibreChat convention).
  if (userRole === SystemRoles.USER && isAgentsEndpoint(endpoint)) {
    const effectiveAgentId = defaultAgentId ?? LEGACY_PRIMARY_AGENT_ID;
    defaultConvo.agent_id = effectiveAgentId;
    defaultConvo.model = effectiveAgentId;
    // USERS cannot toggle tools — they use the agent's configured tools
    defaultConvo.tools = undefined;
  } else {
    // Clear model for non-ephemeral agents - agents use their configured model internally
    clearModelForNonEphemeralAgent(defaultConvo);
    defaultConvo.tools = lastConversationSetup?.tools ?? lastSelectedTools ?? defaultConvo.tools;
  }

  return defaultConvo;
};

export default buildDefaultConvo;
