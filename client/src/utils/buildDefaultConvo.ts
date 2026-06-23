import {
  parseConvo,
  EModelEndpoint,
  isAgentsEndpoint,
  isEphemeralAgentId,
  isAssistantsEndpoint,
} from 'librechat-data-provider';
import type { TConversation, EndpointSchemaKey } from 'librechat-data-provider';
import { clearModelForNonEphemeralAgent } from './endpoints';
import { getLocalStorageItems } from './localStorage';

const buildDefaultConvo = ({
  models,
  conversation,
  endpoint = null,
  lastConversationSetup,
  defaultParamsEndpoint,
}: {
  models: string[];
  conversation: TConversation;
  endpoint?: EModelEndpoint | null;
  lastConversationSetup: TConversation | null;
  defaultParamsEndpoint?: string | null;
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

  // ── Force Universal Agent for agents endpoint (Manus-style) ────────
  // When using the agents endpoint, always use the Universal Agent.
  // Don't use ephemeral agents — always the real Universal Agent.
  if (isAgentsEndpoint(endpoint)) {
    defaultConvo.agent_id = 'universal-agent';
    // For agents endpoint, model = agent_id (not the LLM model name)
    // LibreChat's agents controller uses model field as agent_id to look up the agent
    defaultConvo.model = 'universal-agent';
  }

  // Note: do NOT call clearModelForNonEphemeralAgent here —
  // it sets model=undefined which causes "missing_model" error.
  // For agents endpoint, model must be the agent_id.

  defaultConvo.tools = lastConversationSetup?.tools ?? lastSelectedTools ?? defaultConvo.tools;

  return defaultConvo;
};

export default buildDefaultConvo;
