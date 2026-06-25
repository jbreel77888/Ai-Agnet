import type {
  TPreset,
  TConversation,
  EModelEndpoint,
  TEndpointsConfig,
} from 'librechat-data-provider';
import { SystemRoles } from 'librechat-data-provider';
import { getLocalStorageItems } from './localStorage';
import { mapEndpoints } from './endpoints';

type TConvoSetup = Partial<TPreset> | Partial<TConversation>;

type TDefaultEndpoint = {
  convoSetup: TConvoSetup;
  endpointsConfig: TEndpointsConfig;
  /** Optional: role of the current user. When USER, forces 'agents' endpoint. */
  userRole?: string;
};

const getEndpointFromSetup = (
  convoSetup: TConvoSetup | null,
  endpointsConfig: TEndpointsConfig,
): EModelEndpoint | null => {
  let { endpoint: targetEndpoint = '' } = convoSetup || {};
  targetEndpoint = targetEndpoint ?? '';
  if (targetEndpoint && endpointsConfig?.[targetEndpoint]) {
    return targetEndpoint as EModelEndpoint;
  } else if (targetEndpoint) {
    console.warn(`Illegal target endpoint ${targetEndpoint}`, endpointsConfig);
  }
  return null;
};

const getEndpointFromLocalStorage = (endpointsConfig: TEndpointsConfig) => {
  try {
    const { lastConversationSetup } = getLocalStorageItems();
    const { endpoint } = lastConversationSetup ?? { endpoint: null };
    const isDefaultConfig = Object.values(endpointsConfig ?? {}).every((value) => !value);

    if (isDefaultConfig && endpoint) {
      return endpoint;
    }

    if (isDefaultConfig && endpoint) {
      return endpoint;
    }

    return endpoint && endpointsConfig?.[endpoint] != null ? endpoint : null;
  } catch (error) {
    console.error(error);
    return null;
  }
};

const getDefinedEndpoint = (endpointsConfig: TEndpointsConfig) => {
  const endpoints = mapEndpoints(endpointsConfig);
  return endpoints.find((e) => Object.hasOwn(endpointsConfig ?? {}, e));
};

const getDefaultEndpoint = ({
  convoSetup,
  endpointsConfig,
  userRole,
}: TDefaultEndpoint): EModelEndpoint | undefined => {
  // ── Default-Agent policy ───────────────────────────────────────────
  // ALL users (USER and ADMIN) start new conversations on the agents endpoint
  // by default. The ModeSwitcher in the Header lets users switch to Chat mode
  // (custom endpoint) if they want a plain LLM chat without agent tools.
  //
  // Previously: USER was forced to 'agents' here, and ADMIN fell through to
  // the localStorage/setup logic. Now both roles default to 'agents' for
  // consistency with the new ModeSwitcher UX (Agent Mode = default).
  if (endpointsConfig?.agents) {
    return 'agents' as EModelEndpoint;
  }

  return (
    getEndpointFromSetup(convoSetup, endpointsConfig) ||
    getEndpointFromLocalStorage(endpointsConfig) ||
    getDefinedEndpoint(endpointsConfig)
  );
};

export default getDefaultEndpoint;
