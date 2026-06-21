---
Task ID: railway-log-review
Agent: main
Task: Review Railway production logs and identify issues; also verify the new Workspace feature works once deployed.

Work Log:
- Verified Railway app is alive (https://agent-platform-production-de14.up.railway.app/api/health → 200, uptime ~14h, 37 tables, Redis healthy)
- Logged in as admin@agent-platform.local → got JWT
- Exercised endpoints: /api/sessions (96 sessions), /api/models (6 models), /api/providers (4 providers), /api/tools (8 tools), /api/agents (9 agents), /api/costs/breakdown, /api/storage, /api/logs, /api/system
- Tested live chat: sent "use calculator tool to compute 15 * 37" → got tool_call event with args {expression:"15 * 37"} and tool_result {result:555} ✓
- Tested new endpoints (NOT deployed yet): /api/sessions/[id]/workspace → 404, /api/sessions/[id]/files → 404
- Confirmed messageCount=0 bug is still live on production (96 sessions, all show msgs:0)
- Discovered all 6 models have supportsTools=FALSE / supportsThinking=FALSE despite tools actually working
- Discovered 4 duplicate providers all pointing to https://opencode.ai/zen/v1
- Discovered 9 agents in DB despite "single universal agent" requirement
- Discovered audit log table is empty (/api/logs returns 0 entries)
- Discovered follow-up response after tool call is non-streaming (only 1 message_chunk)
- Created scripts/fix-railway-db.sql with idempotent fixes for DB-level issues

Stage Summary:
- The agent's tool-calling WORKS on Railway (proven by live calculator test)
- The main blockers are: (1) new code not deployed, (2) wrong model capability metadata, (3) duplicate providers, (4) 9 agents still enabled
- SQL fix script ready at /home/z/my-project/scripts/fix-railway-db.sql
- User needs to: commit + push to deploy, then run the SQL script on Railway
