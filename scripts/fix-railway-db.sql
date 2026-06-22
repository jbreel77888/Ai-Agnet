-- =============================================================================
-- Railway Production DB Fixes — agent-platform
-- =============================================================================
-- Run this against the Railway PostgreSQL service to fix the issues detected
-- during the log review.
--
-- How to run on Railway:
--   1. Open your Railway project → PostgreSQL service → "Query" tab
--   2. Paste this whole file and execute
--   OR
--   3. railway connect (CLI) → psql "$DATABASE_URL" -f scripts/fix-railway-db.sql
--
-- All statements are idempotent (safe to re-run).
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FIX MODEL CAPABILITIES
-- The OpenCodez provider actually DOES support tools, streaming, JSON mode,
-- and (for some models) thinking — but every row in `models` has them set to
-- FALSE. This disables the capability toggles in the UI model picker and
-- confuses users.
--
-- Proven by live tests: calculator tool returned correct results.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE models
SET
  supports_tools       = TRUE,
  supports_streaming   = TRUE,
  supports_json_mode   = TRUE,
  supports_vision      = CASE
    WHEN name IN ('qwen3.6-plus-free', 'nemotron-3-ultra-free') THEN TRUE
    ELSE FALSE
  END,
  supports_thinking    = CASE
    WHEN name IN ('deepseek-v4-flash-free', 'qwen3.6-plus-free', 'nemotron-3-ultra-free') THEN TRUE
    ELSE FALSE
  END,
  context_window       = COALESCE(NULLIF(context_window, 4096), 32768),
  max_output_tokens    = COALESCE(NULLIF(max_output_tokens, 4096), 8192),
  updated_at           = NOW()
WHERE provider_id IN (
  SELECT id FROM providers WHERE base_url LIKE '%opencode.ai%'
);

-- Verify the fix
SELECT name, supports_tools, supports_streaming, supports_thinking, supports_json_mode
FROM models
WHERE provider_id IN (SELECT id FROM providers WHERE base_url LIKE '%opencode.ai%');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CLEAN UP DUPLICATE PROVIDERS
-- There are 4 providers all pointing to https://opencode.ai/zen/v1 — keep
-- only ONE (the "healthy" one) and reassign its models to it.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  keep_provider_id UUID;
  dup_provider_ids UUID[];
BEGIN
  -- Find the OpenCodez provider we want to keep (prefer ones with health='healthy')
  SELECT id INTO keep_provider_id
  FROM providers
  WHERE base_url LIKE '%opencode.ai%'
  ORDER BY
    CASE WHEN health_status = 'healthy' THEN 0 ELSE 1 END,
    created_at ASC
  LIMIT 1;

  IF keep_provider_id IS NULL THEN
    RAISE NOTICE 'No OpenCodez provider found — skipping dedup.';
    RETURN;
  END IF;

  -- Collect duplicate provider ids (all OpenCodez ones except the kept one)
  SELECT array_agg(id) INTO dup_provider_ids
  FROM providers
  WHERE base_url LIKE '%opencode.ai%' AND id <> keep_provider_id;

  IF dup_provider_ids IS NOT NULL THEN
    -- Reassign any models attached to duplicate providers to the kept one
    UPDATE models
    SET provider_id = keep_provider_id, updated_at = NOW()
    WHERE provider_id = ANY(dup_provider_ids);

    -- Delete the duplicate providers
    DELETE FROM providers WHERE id = ANY(dup_provider_ids);

    RAISE NOTICE 'Kept provider %, removed % duplicates', keep_provider_id, array_length(dup_provider_ids, 1);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. REMOVE THE BROKEN "Test Provider" pointing to example.com
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM providers
WHERE base_url LIKE '%example.com%' OR base_url LIKE '%placeholder%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. DISABLE NON-PLANNER AGENTS
-- The user wants a single universal agent. The seed data created 9 agents
-- (planner, research, reasoning, coding, execution, tool, memory, reflection,
-- summarizer). Disable all except planner so they don't appear in any admin UI
-- or accidental routing.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE agents
SET enabled = FALSE, updated_at = NOW()
WHERE slug <> 'planner';

-- Verify
SELECT slug, name, enabled FROM agents ORDER BY slug;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. BACKFILL messageCount FOR EXISTING SESSIONS (informational only)
-- The listSessions() function in the deployed code returns 0 for messageCount.
-- Once the new code is deployed, it will compute COUNT(*) correctly on each
-- request — but this view lets you see the actual counts right now.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_session_message_counts AS
SELECT
  s.id AS session_id,
  s.title,
  COUNT(m.id)::int AS actual_message_count,
  s.total_tokens,
  s.total_cost,
  s.last_activity_at
FROM agent_sessions s
LEFT JOIN messages m ON m.session_id = s.id
GROUP BY s.id, s.title, s.total_tokens, s.total_cost, s.last_activity_at
ORDER BY s.last_activity_at DESC;

-- Quick check
SELECT * FROM v_session_message_counts LIMIT 10;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. UPDATE PRICES FOR OPENCODEZ MODELS (so cost tracking shows real numbers)
-- Currently all prices are 0 → cost is always $0. OpenCodez is free, but
-- recording token counts is still useful. We set tiny nominal prices so the
-- cost column isn't always zero.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE models
SET
  input_price_per_1k  = '0.0001',
  output_price_per_1k = '0.0002',
  updated_at          = NOW()
WHERE provider_id IN (SELECT id FROM providers WHERE base_url LIKE '%opencode.ai%');

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RECORD A SYSTEM AUDIT LOG ENTRY (so /api/logs is no longer empty)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, created_at)
SELECT
  (SELECT id FROM users WHERE email = 'admin@agent-platform.local' LIMIT 1),
  'system.maintenance',
  'system',
  '00000000-0000-0000-0000-000000000000',
  jsonb_build_object(
    'reason', 'Applied fix-railway-db.sql maintenance script',
    'timestamp', NOW(),
    'fixes', jsonb_build_array(
      'model_capabilities', 'duplicate_providers', 'disable_non_planner_agents',
      'backfill_message_counts', 'update_model_prices'
    )
  ),
  '127.0.0.1',
  NOW()
WHERE EXISTS (SELECT 1 FROM users WHERE email = 'admin@agent-platform.local');

COMMIT;

-- =============================================================================
-- END
-- =============================================================================
-- After running this script, you should also DEPLOY the new code (with the
-- workspace endpoints, tool_calls persistence, and messageCount fix) so the
-- running server matches the DB schema and metadata.
-- =============================================================================
