const { logger } = require('@librechat/data-schemas');
const mongoose = require('mongoose');
const {
  Constants,
  Permissions,
  ResourceType,
  SystemRoles,
  PermissionTypes,
  isAgentsEndpoint,
  isEphemeralAgentId,
} = require('librechat-data-provider');
const { checkPermission } = require('~/server/services/PermissionService');
const { canAccessResource } = require('./canAccessResource');
const db = require('~/models');

const { getRoleByName, getAgent } = db;

/**
 * The central agent that all USER-role conversations must use.
 * ADMIN can use any agent; USER can only use this one.
 */
const PRIMARY_AGENT_ID = 'agent_primary';

/**
 * Resolves custom agent ID (e.g., "agent_abc123") to a MongoDB document.
 * @param {string} agentCustomId - Custom agent ID from request body
 * @returns {Promise<Object|null>} Agent document with _id field, or null if ephemeral/not found
 */
const resolveAgentIdFromBody = async (agentCustomId) => {
  if (isEphemeralAgentId(agentCustomId)) {
    return null;
  }
  return getAgent({ id: agentCustomId });
};

/**
 * Creates a `canAccessResource` middleware for the given agent ID
 * and chains to the provided continuation on success.
 *
 * @param {string} agentId - The agent's custom string ID (e.g., "agent_abc123")
 * @param {number} requiredPermission - Permission bit(s) required
 * @param {import('express').Request} req
 * @param {import('express').Response} res - Written on deny; continuation called on allow
 * @param {Function} continuation - Called when the permission check passes
 * @returns {Promise<void>}
 */
const checkAgentResourceAccess = (agentId, requiredPermission, req, res, continuation) => {
  const middleware = canAccessResource({
    resourceType: ResourceType.AGENT,
    requiredPermission,
    resourceIdParam: 'agent_id',
    idResolver: () => resolveAgentIdFromBody(agentId),
  });

  const tempReq = {
    ...req,
    params: { ...req.params, agent_id: agentId },
  };

  return middleware(tempReq, res, continuation);
};

/**
 * Middleware factory that validates MULTI_CONVO:USE role permission and, when
 * addedConvo.agent_id is a non-ephemeral agent, the same resource-level permission
 * required for the primary agent (`requiredPermission`). Caches the resolved agent
 * document on `req.resolvedAddedAgent` to avoid a duplicate DB fetch in `loadAddedAgent`.
 *
 * @param {number} requiredPermission - Permission bit(s) to check on the added agent resource
 * @returns {(req: import('express').Request, res: import('express').Response, next: Function) => Promise<void>}
 */
const checkAddedConvoAccess = (requiredPermission) => async (req, res, next) => {
  const addedConvo = req.body?.addedConvo;
  if (!addedConvo || typeof addedConvo !== 'object' || Array.isArray(addedConvo)) {
    return next();
  }

  try {
    if (!req.user?.role) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions for multi-conversation',
      });
    }

    if (req.user.role !== SystemRoles.ADMIN) {
      const role = await getRoleByName(req.user.role);
      const hasMultiConvo = role?.permissions?.[PermissionTypes.MULTI_CONVO]?.[Permissions.USE];
      if (!hasMultiConvo) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Multi-conversation feature is not enabled',
        });
      }
    }

    const addedAgentId = addedConvo.agent_id;
    if (!addedAgentId || typeof addedAgentId !== 'string' || isEphemeralAgentId(addedAgentId)) {
      return next();
    }

    if (req.user.role === SystemRoles.ADMIN) {
      return next();
    }

    const agent = await resolveAgentIdFromBody(addedAgentId);
    if (!agent) {
      return res.status(404).json({
        error: 'Not Found',
        message: `${ResourceType.AGENT} not found`,
      });
    }

    const hasPermission = await checkPermission({
      userId: req.user.id,
      role: req.user.role,
      resourceType: ResourceType.AGENT,
      resourceId: agent._id,
      requiredPermission,
    });

    if (!hasPermission) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Insufficient permissions to access this ${ResourceType.AGENT}`,
      });
    }

    req.resolvedAddedAgent = agent;
    return next();
  } catch (error) {
    logger.error('Failed to validate addedConvo access permissions', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to validate addedConvo access permissions',
    });
  }
};

/**
 * Middleware factory that checks agent access permissions from request body.
 * Validates both the primary agent_id and, when present, addedConvo.agent_id
 * (which also requires MULTI_CONVO:USE role permission).
 *
 * @param {Object} options - Configuration options
 * @param {number} options.requiredPermission - The permission bit required (1=view, 2=edit, 4=delete, 8=share)
 * @returns {Function} Express middleware function
 *
 * @example
 * router.post('/chat',
 *   canAccessAgentFromBody({ requiredPermission: PermissionBits.VIEW }),
 *   buildEndpointOption,
 *   chatController
 * );
 */
const canAccessAgentFromBody = (options) => {
  const { requiredPermission } = options;

  if (!requiredPermission || typeof requiredPermission !== 'number') {
    throw new Error('canAccessAgentFromBody: requiredPermission is required and must be a number');
  }

  const addedConvoMiddleware = checkAddedConvoAccess(requiredPermission);

  return async (req, res, next) => {
    try {
      const { endpoint, agent_id } = req.body;
      let agentId = agent_id;

      // ── Default-Agent policy (DB-driven) ──────────────────────────────
      // USER role must use the default agent on the agents endpoint.
      // The default agent is determined by querying the DB for isDefault=true
      // for the user's role. Falls back to legacy 'agent_primary' if no
      // default agent is configured.
      // ADMIN role can use any agent they pick via the Agent Builder side
      // panel, but if no agent_id is provided, the default agent is used.
      if (req.user?.role === SystemRoles.USER) {
        if (!isAgentsEndpoint(endpoint)) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Users can only use the agents endpoint.',
          });
        }
      }

      // Resolve the default agent ID from DB (used as fallback for both
      // USER and ADMIN when no specific agent_id is provided on the agents
      // endpoint). Falls back to legacy 'agent_primary' if not configured.
      let resolvedDefaultId = PRIMARY_AGENT_ID; // legacy fallback
      try {
        const Agent = mongoose.models.Agent;
        if (Agent) {
          const userRole = req.user?.role ?? SystemRoles.USER;
          const defaultAgent = await Agent.findOne({
            tenantId: req.user?.tenantId,
            isDefault: true,
            defaultForRoles: userRole,
          }).lean();
          if (defaultAgent?.id) {
            resolvedDefaultId = defaultAgent.id;
          }
        }
      } catch (lookupErr) {
        logger.warn(
          '[canAccessAgentFromBody] Failed to lookup default agent, using legacy fallback:',
          lookupErr?.message,
        );
      }

      // For USER role, always force the default agent on the agents endpoint.
      if (req.user?.role === SystemRoles.USER && isAgentsEndpoint(endpoint)) {
        agentId = resolvedDefaultId;
        req.body.agent_id = resolvedDefaultId;
        req.body.model = resolvedDefaultId;
      }

      // For ADMIN role on agents endpoint with no agent_id, use the default.
      // This happens when the ModeSwitcher starts a new conversation in Agent
      // Mode without an explicit agent selection.
      if (
        req.user?.role === SystemRoles.ADMIN &&
        isAgentsEndpoint(endpoint) &&
        !agentId
      ) {
        agentId = resolvedDefaultId;
        req.body.agent_id = resolvedDefaultId;
        req.body.model = resolvedDefaultId;
      }

      if (!isAgentsEndpoint(endpoint)) {
        agentId = Constants.EPHEMERAL_AGENT_ID;
      }

      if (!agentId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'agent_id is required in request body',
        });
      }

      const afterPrimaryCheck = () => addedConvoMiddleware(req, res, next);

      if (isEphemeralAgentId(agentId)) {
        return afterPrimaryCheck();
      }

      return checkAgentResourceAccess(agentId, requiredPermission, req, res, afterPrimaryCheck);
    } catch (error) {
      logger.error('Failed to validate agent access permissions', error);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to validate agent access permissions',
      });
    }
  };
};

module.exports = {
  canAccessAgentFromBody,
};
