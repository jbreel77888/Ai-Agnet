/**
 * restrictUserEndpoints.js
 *
 * Middleware that enforces the central-agent model:
 * - USER role can ONLY use the `agents` endpoint
 * - USER role must use the `primary-agent` agent_id
 * - ADMIN role can use any endpoint and any agent
 *
 * Apply this middleware on agent/chat routes AFTER requireJwtAuth.
 */
const { SystemRoles, isAgentsEndpoint } = require('librechat-data-provider');

const PRIMARY_AGENT_ID = 'primary-agent';

/**
 * Forces USER-role requests to use agents endpoint + primary-agent.
 * ADMIN role is not affected.
 */
function restrictUserEndpoints(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
  }

  // ADMIN can do whatever they want
  if (req.user.role === SystemRoles.ADMIN) {
    return next();
  }

  // For all non-admin roles (USER primarily):
  if (req.user.role === SystemRoles.USER) {
    // Force endpoint to 'agents' (no custom/openAI/anthropic/etc.)
    if (req.body.endpoint && !isAgentsEndpoint(req.body.endpoint)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Users can only use the agents endpoint. Direct provider access is not allowed.',
      });
    }
    req.body.endpoint = 'agents';

    // Force agent_id and model to primary-agent
    req.body.agent_id = PRIMARY_AGENT_ID;
    req.body.model = PRIMARY_AGENT_ID;

    return next();
  }

  // Unknown role — deny by default
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Your role does not have permission to access this resource.',
  });
}

module.exports = restrictUserEndpoints;
