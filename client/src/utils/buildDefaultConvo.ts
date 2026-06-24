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
 * The central agent that all USER-role conversations must use.
 * ADMIN can use any agent; USER can only use this one.
 */
const PRIMARY_AGENT_ID = 'primary-agent';

const buildDefaultConvo = ({
  models,
  conversation,
  endpoint = null,
  lastConversationSetup,
  defaultParamsEndpoint,
  userRole,
}: {
  models: string[];
  conversation: TConversation;
  endpoint?: EModelEndpoint | null;
  lastConversationSetup: TConversation | null;
  defaultParamsEndpoint?: string | null;
  /** Optional: role of the current user. When USER, forces primary-agent. */
  userRole?: string;
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
  const defaultAgentId = lastConversationSetup?.agent_id ?? '';
  if (
    isAgentsEndpoint(endpoint) &&
    agentId &&
    (!defaultAgentId || isEphemeralAgentId(defaultAgentId))
  ) {
    defaultConvo.agent_id = agentId;
  }

  // ── Central-agent policy ───────────────────────────────────────────
  // USER role always uses primary-agent on the agents endpoint.
  // The model field for agents endpoint = agent_id (LibreChat convention).
  if (userRole === SystemRoles.USER && isAgentsEndpoint(endpoint)) {
    defaultConvo.agent_id = PRIMARY_AGENT_ID;
    defaultConvo.model = PRIMARY_AGENT_ID;
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
