/**
 * OpenCodez Proxy — strips Authorization header before forwarding to OpenCodez API.
 * ─────────────────────────────────────────────────────────────────────────────
 * OpenCodez (https://opencode.ai/zen/v1) doesn't require any API key.
 * Sending `Authorization: Bearer xxx` causes 401 errors.
 *
 * This proxy:
 *   1. Receives requests at /api/opencodez/*
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

// Middleware: log all requests for debugging
router.use((req, _res, next) => {
  console.log(`[OpenCodez Proxy] ${req.method} ${req.url}`);
  next();
});

// Catch-all handler for all methods and paths
router.use(async (req, res) => {
  // req.url is relative to the mount point (/api/opencodez)
  // e.g., "/v1/chat/completions"
  const targetUrl = `${OPENCODEZ_BASE}${req.url}`;

  console.log(`[OpenCodez Proxy] Forwarding to: ${targetUrl}`);
  console.log(`[OpenCodez Proxy] Method: ${req.method}`);
  console.log(`[OpenCodez Proxy] Has body: ${!!req.body}`);

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': req.headers['accept'] || 'application/json',
      },
    };

    // Add body for POST/PUT/PATCH — req.body is already parsed by express.json()
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
      console.log(`[OpenCodez Proxy] Body: ${JSON.stringify(req.body).substring(0, 200)}`);
    }

    const response = await fetch(targetUrl, fetchOptions);

    console.log(`[OpenCodez Proxy] Response status: ${response.status}`);
    console.log(`[OpenCodez Proxy] Response content-type: ${response.headers.get('content-type')}`);

    // Set status code
    res.status(response.status);

    // Copy content-type header
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    // Check if this is a streaming response (SSE)
    if (contentType && contentType.includes('text/event-stream')) {
      // Stream the response back
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
      } catch (streamErr) {
        console.log('[OpenCodez Proxy] Stream ended (client disconnect)');
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
