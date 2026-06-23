/**
 * OpenCodez Proxy — strips Authorization header before forwarding to OpenCodez API.
 * ─────────────────────────────────────────────────────────────────────────────
 * OpenCodez (https://opencode.ai/zen/v1) doesn't require any API key.
 * Sending `Authorization: Bearer xxx` causes 401 errors.
 *
 * This proxy:
 *   1. Receives requests at /api/opencodez/v1/*
 *   2. Removes the Authorization header
 *   3. Forwards to https://opencode.ai/zen/v1/*
 *   4. Streams the response back (supports SSE)
 *
 * Usage in librechat.yaml:
 *   baseURL: 'http://localhost:3080/api/opencodez/v1'
 */
const express = require('express');
const router = express.Router();

const OPENCODEZ_BASE = 'https://opencode.ai/zen/v1';

// Proxy all requests to OpenCodez, stripping the Authorization header
// Express 5 (path-to-regexp v8) requires named params, not /*
router.use(async (req, res) => {
  const path = req.url.replace(/^\//, '');
  const targetUrl = `${OPENCODEZ_BASE}/${path}`;

  // Clone headers but remove Authorization
  const headers = { ...req.headers };
  delete headers['authorization'];
  delete headers['host'];
  delete headers['connection'];
  headers['host'] = 'opencode.ai';

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': req.headers['accept'] || 'application/json',
      },
    };

    // Add body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    // Set status code
    res.status(response.status);

    // Copy content-type header
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    // Check if this is a streaming response (SSE)
    if (contentType && contentType.includes('text/event-stream')) {
      // Stream the response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(encoder.encode(decoder.decode(value, { stream: true })));
        }
      } catch (streamErr) {
        // Client disconnected
      } finally {
        res.end();
      }
    } else {
      // Non-streaming: read full response and send
      const text = await response.text();
      res.send(text);
    }
  } catch (err) {
    console.error('[OpenCodez Proxy] Error:', err.message);
    res.status(502).json({
      error: {
        type: 'proxy_error',
        message: `Failed to reach OpenCodez: ${err.message}`,
      },
    });
  }
});

module.exports = router;
