const { getEndpointsConfig } = require('~/server/services/Config');
const { SystemRoles } = require('librechat-data-provider');

/**
 * Returns the endpoints configuration to the client.
 *
 * For USER role, filters out non-agents endpoints (e.g. `custom`)
 * so the frontend ModelSelector only shows the agents endpoint.
 * ADMIN role sees the full config.
 */
async function endpointController(req, res) {
  const endpointsConfig = await getEndpointsConfig(req);

  // Central-agent policy: USER can only see/use the `agents` endpoint.
  if (req.user?.role === SystemRoles.USER && endpointsConfig) {
    const filtered = {};
    if (endpointsConfig.agents) {
      filtered.agents = endpointsConfig.agents;
    }
    return res.send(JSON.stringify(filtered));
  }

  res.send(JSON.stringify(endpointsConfig));
}

module.exports = endpointController;
