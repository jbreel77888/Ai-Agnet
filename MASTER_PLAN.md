# 🎯 المستند المرجعي الموحّد — منصة الوكلاء الذكية (Universal Cloud Agent Platform)

> **تاريخ الإنشاء**: 22 يونيو 2026
> **المصادر**: دمج وتوحيد تحليلين مستقلين من وكلاء مختلفين (`المرحله الاولى.md` + `المرحلة_الأولى.md`)
> **الهدف**: مرجع وحيد للعمل المتدرّج، يُحدَّث بعد كل مهمة منجزة
> **المستودع**: https://github.com/jbreel77888/Ai-Agnet
> **الإنتاج**: https://agent-platform-production-de14.up.railway.app
> **المشروع على Railway**: pacific-luck

---

## 📋 كيفية استخدام هذا المستند

1. هذا الملف هو **المرجع الوحيد** لتتبّع تقدّم المشروع.
2. كل مهمة موسومة بحالة: `[ ]` لم تُنجز بعد / `[~]` قيد التنفيذ / `[x]` مُنجزة.
3. بعد إنجاز كل مهمة، **يجب تحديث حالتها هنا** مع تاريخ الإنجاز وcommit hash.
4. المهام مرتبة حسب الأولوية (P0 قصوى → P3 موثوقية) ومجموعة في مراحل (Sprints).
5. لا تُضَف مهام جديدة إلا بعد مناقشتها وإدراجها في المرحلة المناسبة.

---

## 🏥 الوضع الراهن — لقطة سريعة (Snapshot)

| المحور | الحالة | النسبة | ملاحظات |
|---|---|---|---|
| Framework (Next.js 16 + React 19 + TS 5) | ✅ | 95% | Turbopack يعمل، Build ناجح |
| Database (PostgreSQL + Drizzle + 35 جدول) | ✅ | 85% | Prisma/SQLite تم حذفهما |
| Auth (JWT + RBAC) | ✅ | 70% | يعمل، ينقصه tool-level permissions |
| Providers (OpenAI/Anthropic/Gemini strategies) | ✅ | 75% | لا Groq/OpenRouter/DeepSeek |
| Agents (9 موثّقة، 9 مفعّلة في DB) | ✅ | 60% | Router ديناميكي يعمل (Arabic+English) |
| Tools (8 مسجّلة: 3 منها ضعيفة) | ⚠️ | 30% | **الفجوة الأكبر** |
| Memory (short-term Redis + long-term stub) | ⚠️ | 40% | لا embeddings حقيقية |
| RAG (schema موجود فقط) | ❌ | 15% | لا ingestion pipeline |
| Workflows (DAG executor stub) | ❌ | 20% | غير منفّذ |
| MCP (types فقط) | ❌ | 5% | لا servers متصلة |
| Background Jobs (BullMQ queues بدون workers) | ⚠️ | 30% | **عائق للمهام الطويلة** |
| Observability (Pino + cost tracker أساسي) | ⚠️ | 50% | لا OpenTelemetry |
| Storage (S3 stub + local) | ⚠️ | 40% | يعمل لملفات الجلسات |
| Chat UI (Manus-style: Thinking/ToolCard/Workspace) | ✅ | 70% | يعمل، ينقصه live preview |
| Computer/Sandbox (Tensorlake اختياري فقط) | ❌ | 10% | **العائق الأكبر لمستوى Manus** |
| Tool Calls Persistence | ✅ | 90% | محفوظة في DB + معروضة في Workspace |
| Workspace Panel (Files/Tools/Activity/Env) | ✅ | 90% | يعمل على الإنتاج |
| Dynamic Agent Routing | ✅ | 85% | router + agent_selected SSE + per-agent avatar |

**التقييم الإجمالي**: ~35% من مستوى Manus AI (نفس تقييم المستند الثاني).

---

## 🚨 المشاكل الهيكلية الحرجة (Critical Architectural Issues)

### 1. حلقة التنفيذ ذات خطوة واحدة (No ReAct Loop) — **P0**
**الموقع**: `src/agents/base/index.ts`
**المشكلة**: الوكيل ينفّذ LLM call → tool call واحد → follow-up call واحد → ينتهي.
**المطلوب**: حلقة `while` متعددة الخطوات (ReAct Autonomous Loop) تصل إلى 20-50 خطوة مع self-correction.
**الحل**: إعادة كتابة `execute()` في `BaseAgent` لتدعم حلقة ReAct مع `maxStepsPerRun`.

### 2. لا معالجة خلفية للمهام (No BullMQ Workers) — **P0**
**الموقع**: `src/background/queues/index.ts`
**المشكلة**: Queues معرّفة ولكن لا يوجد worker واحد فعّال. الـ orchestrator يُنفّذ مباشرة في طلب HTTP/SSE.
**الأثر**: Railway timeout بعد 5 دقائق، انقطاع المهام الطويلة.
**الحل**: بناء `agent-worker.ts` منفصل يعمل كـ background process، يتواصل مع الـ frontend عبر Redis pub/sub أو polling.

### 3. Sandbox عديم الحالة (Stateless Sandbox) — **P0**
**الموقع**: `src/tools/builtin/tensorlake.ts`
**المشكلة**: في كل استدعاء: `Sandbox.create()` → تنفيذ → `sandbox.terminate()`. الملفات تُدمَّر بعد كل خطوة.
**الحل**: ربط `sandboxId` بـ `agent_sessions.metadata`، استدعاء `Sandbox.connect(sandboxId)` بدل create، إزالة `terminate()` من `finally`.

### 4. المتصفح يفقد الجلسة بين الخطوات — **P1**
**الموقع**: `src/tools/builtin/browser.ts`
**المشكلة**: Playwright يفتح متصفح جديد لكل عملية، ثم يُغلقه. لا يمكن تسجيل دخول ثم التصفح متعدد الخطوات.
**الحل**: إعادة استخدام browser context محفوظ في `session.metadata.browserSessionId`، إضافة screenshot streaming.

### 5. تمرير نتائج الأدوات بطريقة ملتوية (Hacky Tool Feeding) — **P1**
**الموقع**: `src/agents/base/index.ts` (السطر ~195)
**المشكلة**: نتائج الأدوات تُمرَّر للنموذج كرسالة `user` بدل `role: 'tool'` مع `tool_call_id`.
**الأثر**: يربك النماذج المتقدمة (DeepSeek, Claude, GPT-4)، يفقد تتبّع النجاح/الفشل.
**الحل**: استخدام `role: 'tool'` حقيقي في `toOpenAIMessages()` (موجود partial في `base.ts`).

### 6. لا Tool Permissions / Rate Limit / Audit — **P1**
**الموقع**: `src/tools/registry/index.ts` (91 سطر فقط)
**المشكلة**: الـ `execute()` يفعل `validate → execute → catch` فقط. لا security layer.
**الحل**: إضافة permissions check, rate limiter, audit log, timeout per-tool, cost tracking.

### 7. تضارب Prisma/Drizzle — **P3** (✅ تم حله)
**الموقع**: `prisma/schema.prisma` + `db/custom.db`
**الحل المُطبَّق**: حُذفا من الريبو في هذا التحديث. `@prisma/client` و `prisma` أُزيلت من `package.json`.

---

## 🗺️ خارطة الطريق — المراحل (Sprints)

### 🟢 المرحلة 0 — إصلاحات حرجة فورية (Quick Wins)
> أهداف سريعة لا تتطلب APIs خارجية، تُنجَز في 1-2 يوم.

- [x] **0.1** حذف `prisma/schema.prisma` و `db/custom.db` — **تم 2026-06-22** (commit `e480fa3`)
- [x] **0.2** إزالة `@prisma/client` و `prisma` من `package.json` — **تم 2026-06-22** (commit `e480fa3`)
- [x] **0.3** استبدال `calculator` tool (الذي يستخدم `Function('Math',...)` خطر XSS) بـ whitelist validator آمن — **تم 2026-06-22** (commit `feebe13`)
- [x] **0.4** إضافة SSRF protection في `http_request` tool (block localhost/private IPs/metadata) — **تم 2026-06-22** (commit `feebe13`)
- [x] **0.5** التحقق من `JWT_SECRET` في Railway (يجب أن يكون `openssl rand -hex 32`) — **تم 2026-06-22** (verified: 32-byte hex = 256-bit, strong ✓)
- [x] **0.6** نقل `playwright` من `dependencies` إلى `optionalDependencies` (يوفّر 200MB) — **تم 2026-06-22** (commit `58a3b7e`)
- [x] **0.7** فحص `z-ai-web-dev-sdk` في package.json — حذفه إن لم يُستخدم — **تم 2026-06-22** (commit `58a3b7e`, غير مستخدم في src/)
- [ ] **0.8** حفظ `tool_calls` في DB بشكل streaming (الآن تُحفظ بعد انتهاء الرسالة فقط)
- [x] **0.9** إضافة rate limit على `/api/chat` و `/api/sessions/[id]/messages` (e.g., 30 req/min per user) — **تم 2026-06-22** (commit `58a3b7e`)
  - `/api/sessions/[id]/messages`: 30 msgs/min/user + 429 with Retry-After header ✓
  - `/api/auth/login`: 5 attempts/min/IP (brute force protection) ✓
  - Generic `checkRateLimit()` utility in `src/lib/rate-limit.ts` ✓

### 🔴 المرحلة 1 — Computer/Sandbox Foundation (P0)
> الهدف: تحويل المنصة من "chatbot مع tools" إلى "Manus-like agent computer".
> يتطلب: مفتاح `E2B_API_KEY` (أفضل) أو `TENSORLAKE_API_KEY`.

#### 1.A — Stateful Sandbox
- [x] **1.1** تعديل `src/tools/builtin/tensorlake.ts`: — **تم 2026-06-22** (commit `281a263`)
  - قراءة `sandboxId` من `agent_sessions.metadata` ✓ (via `SandboxManager`)
  - استخدام `Sandbox.connect(sandboxId)` إن وُجد ✓
  - حفظ `sandboxId` جديد في DB عند الإنشاء الأول ✓
  - حذف `await sandbox.terminate()` من `finally` ✓
- [x] **1.2** إضافة cleanup hook عند `deleteSession()`: استدعاء `sandbox.terminate()` + مسح `metadata.sandboxId` — **تم 2026-06-22** (commit `281a263`)
- [ ] **1.3** إضافة idle timeout (30 دقيقة) في إعدادات إنشاء Sandbox (Tensorlake auto-handles this — low priority)

#### 1.B — File Manager Tool (جديد)
- [x] **1.4** إنشاء `src/tools/builtin/file_manager.ts`: — **تم 2026-06-22** (commit `281a263`)
  - actions: `read`, `write`, `list`, `edit`, `delete`, `mkdir`, `exists` ✓
  - يعمل على filesystem الساندبوكس (Tensorlake) ✓
- [x] **1.5** ربط `file_manager` بـ Workspace Panel (تحديث `/api/sessions/[id]/files` لعرض ملفات الساندبوكس) — **تم جزئياً** (DB-based files already work, sandbox file listing pending)
- [ ] **1.6** إضافة `file_upload` tool: المستخدم يرفع ملف → يُخزَّن في sandbox

#### 1.C — Code Interpreter (جديد)
- [x] **1.7** إنشاء `src/tools/builtin/code_interpreter.ts` (مدمج في `tensorlake.ts` كـ `code_execution`): — **تم 2026-06-22** (commit `281a263`)
  - يدعم Python + Node.js + Bash ✓
  - يُنفَّذ داخل نفس الـ sandbox (حالة مستمرة) ✓
  - يُرجع stdout/stderr + exit code + duration ✓
- [x] **1.8** دعم matplotlib → artifacts (Charts كصور PNG) — **تم 2026-06-22** (commit `fad70b6`)
  - code_execution يكتشف الملفات المُولّدة تلقائياً (png/jpg/svg/csv/html/json)
  - يقرأ الملفات < 2MB ويرجعها كـ data URLs
  - الـ UI يعرضها كـ artifacts (صور/جداول/HTML live preview)
- [x] **1.9** دعم `pip install` و `npm install` (يُحفظ في نفس الـ sandbox) — **تم** (عبر shell tool)

#### 1.D — Shell/Terminal Tool (جديد)
- [x] **1.10** إنشاء `src/tools/builtin/shell.ts`: — **تم 2026-06-22** (commit `281a263`)
  - bash execution داخل sandbox ✓
  - stdout streaming ✓
  - working directory persistent بين الاستدعاءات ✓
  - blocks dangerous commands (rm -rf /, mkfs, fork bombs) ✓

#### 1.E — Artifact Live Preview (تحسين UI)
- [x] **1.11** تحديث `ArtifactViewer.tsx`: — **تم 2026-06-22** (commit `fad70b6`)
  - HTML artifacts: render في `<iframe sandbox>` مع live preview ✓
  - React artifacts: (deferred — requires Babel standalone, heavy)
  - CSV: عرض كجدول تفاعلي ✓ (sticky header, hover, row×col count)
  - PNG/JPG: gallery مع zoom ✓ (existing image support)
  - SVG: render inline ✓ (dangerouslySetInnerHTML)
  - Auto-detection: detectType() from extension + content ✓

### 🟡 المرحلة 2 — Web & Research Tools (P1)
> الهدف: وكيل قادر على البحث الحقيقي والاستقصاء.

- [x] **2.1** استبدال `web_search` (DuckDuckGo ميت) بـ **Tavily API**: — **تم 2026-06-22** (commit `281a263`)
  - إنشاء `src/tools/builtin/web_search_tavily.ts` (`tavily.ts`) ✓
  - يتطلب `TAVILY_API_KEY` ✓ (مُعَدّ على Railway)
  - يُرجع results + answer summary + raw content ✓
  - يدعم topic filter (general/news/finance) + time filter ✓
- [x] **2.2** إضافة `web_scrape` tool باستخدام **Jina Reader**: — **تم 2026-06-22** (commit `281a263`)
  - يحوّل أي صفحة لـ Markdown نظيف ✓
  - مجاني، لا يتطلب API key ✓
- [x] **2.3** تحديث `browser` tool: — **تم 2026-06-22** (commit `fad70b6`)
  - إعادة استخدام browser context عبر sessions ✓ (per-session Map)
  - screenshot بعد كل عملية ✓ (existing, now stateful)
  - screenshot streaming للواجهة (WebSocket أو SSE) ⚠️ (deferred — current screenshot in tool result)
  - 16 actions total (was 8): navigate, screenshot, extract_text, click, fill, evaluate, get_title, scroll, go_back, go_forward, get_url, wait_for, press_key, hover, select_option, close ✓
  - Health check on reuse: if page crashed, recreate ✓
  - Idle session cleanup (10 min timeout) ✓
  - closeSessionBrowser() called on session delete ✓
- [x] **2.4** إصلاح Tool Registry (`src/tools/registry/index.ts`): — **تم 2026-06-22** (commit `58a3b7e`, `7adc3ba`)
  - إضافة `permissions` check (RBAC per tool) ✓ (`requiredPermissions` field)
  - إضافة `rateLimiter` per user per tool ✓ (default 60/min, configurable)
  - إضافة `timeout` per tool (default 30s) ✓ (max 5min)
  - إضافة `auditLog` write لكل تنفيذ ✓ (batched, async, to `audit_logs` table)
  - إضافة `costTracker` per tool ✓ (optional `costEstimate` field)
  - إضافة `allowedArgs` / `deniedArgs` constraints ⚠️ (not yet — use tool.validate())

### 🔵 المرحلة 3 — Multi-Agent Orchestration (P0/P1)
> الهدف: تفعيل الـ 9 وكلاء فعلياً مع handoffs وsub-agents.

- [x] **3.1** تفعيل الـ 9 وكلاء في DB — **تم 2026-06-22** (كانوا معطّلين)
- [x] **3.2** بناء `AgentRouter` (`src/agents/router/index.ts`) — **تم 2026-06-22**
- [x] **3.3** إضافة `agent_selected` SSE event — **تم 2026-06-22**
- [x] **3.4** عرض الـ agent ديناميكياً في MessageBubble (لون + أيقونة + badge) — **تم 2026-06-22**
- [x] **3.5** بناء `AgentEngine.execute()` الحقيقي بـ ReAct loop — **تم 2026-06-22** (commit `feebe13`)
  - `while (step < maxSteps && !completed)` حلقة ✓
  - في كل خطوة: LLM call → tool calls → feedback → repeat ✓
  - `maxStepsPerRun = 20` (configurable per agent) ✓
  - self-correction عند فشل أداة ✓ (error in tool result → fed back to LLM)
- [ ] **3.6** تفعيل `handoff_request` event:
  - عند إحالة من planner → research، emit event
  - TaskTimeline يعرض handoff كـ step
- [ ] **3.7** تفعيل `subagent_spawned` event:
  - وكيل planner يُنشئ sub-agent متوازي (e.g., research + coding)
  - SubAgentPool manages lifecycle
- [x] **3.8** إصلاح تمرير نتائج الأدوات لـ `role: 'tool'` بدل `role: 'user'` hack — **تم 2026-06-22** (commit `feebe13`)
- [ ] **3.9** إضافة Budget guard:
  - `maxTotalSteps = 100` per session
  - `maxTotalCost = $10` per session
  - halt عند تجاوز الحد
- [ ] **3.10** إضافة Agent Metrics + HealthCheck endpoints

### 🟣 المرحلة 4 — Background Workers (P0)
> الهدف: المهام الطويلة لا تنقطع بـ HTTP timeout.

- [ ] **4.1** إنشاء `src/background/workers/agent-worker.ts`:
  - يستهلك من `agent-execution` queue
  - يُشغّل `AgentEngine.execute()` كاملاً
  - يبث الأحداث لـ Redis pub/sub على `session:{id}:events`
- [ ] **4.2** تعديل `/api/sessions/[id]/messages` route:
  - بدل استدعاء `orchestrator.sendMessage()` مباشرة
  - يدفع job لـ queue ويرجع `jobId` فوراً
  - SSE endpoint منفصل يبث من Redis pub/sub
- [ ] **4.3** إنشاء `src/background/workers/tool-worker.ts`:
  - يستهلك من `tool-execution` queue
  - للأدوات الثقيلة (browser, code_interpreter)
- [ ] **4.4** إضافة healthcheck للـ workers في `/api/health`
- [ ] **4.5** تشغيل الـ worker كـ separate process في Railway (Procfile أو railway.json)

### 🟠 المرحلة 5 — RAG & Memory (P1)
> الهدف: ذاكرة طويلة الأمد حقيقية + استرجاع معرفي.

- [ ] **5.1** تفعيل pgvector: `CREATE EXTENSION IF NOT EXISTS vector;`
- [ ] **5.2** إضافة OpenAI embeddings strategy: `text-embedding-3-small`
- [ ] **5.3** بناء RAG ingestion pipeline:
  - `rag_ingest` tool: يحتاج `file` أو `url`
  - chunking: `RecursiveCharacterTextSplitter` (chunk size 1000, overlap 200)
  - embedding + storage في `document_chunks`
- [ ] **5.4** `rag_query` tool: cosine similarity search في pgvector
- [ ] **5.5** تحديث `memory_store` لاستخدام embeddings حقيقية (بدل stub الحالي)
- [ ] **5.6** تحديث `memory_search` لـ vector similarity search
- [ ] **5.7** context compression: ضغط الـ history الطويل قبل LLM call

### 🟤 المرحلة 6 — Creative & Integrations (P2)
> الهدف: ميزات Manus/Kimi المتقدمة.

- [ ] **6.1** `image_generation` tool عبر **fal.ai flux schnell** (سريع ورخيص)
- [ ] **6.2** `csv_analyzer` tool (pandas inside code_interpreter)
- [ ] **6.3** `chart_generator` tool (matplotlib → PNG artifact)
- [ ] **6.4** `pdf_reader` tool (pdf-parse → text)
- [ ] **6.5** `image_analyzer` tool (vision: GPT-4o / Gemini)
- [ ] **6.6** `github_pr_create` tool (Octokit كامل: PR + commit + review)
- [ ] **6.7** `gmail_send` / `gmail_read` tools (Gmail API)
- [ ] **6.8** `notion` tool كامل (@notionhq/client: pages + databases)
- [ ] **6.9** `slack_post` tool (@slack/web-api)
- [ ] **6.10** `postgres_query` tool (read-only مع allowlist)
- [ ] **6.11** Vision input في chat (المستخدم يرفع صورة → تحليل)

### ⚫ المرحلة 7 — Resilience & Observability (P2/P3)
> الهدف: موثوقية إنتاج + قابلية تتبّع.

- [ ] **7.1** MCP Client فعّال (`src/mcp/client/`):
  - اتصال ديناميكي بأي MCP server
  - 3 servers مبدئية: filesystem, github, postgres
- [ ] **7.2** Workflow DAG engine (`src/workflows/executor/`):
  - branches, parallel, retry, checkpoints
- [ ] **7.3** OpenTelemetry tracing (`@opentelemetry/api`)
- [ ] **7.4** Human-in-the-Loop approvals:
  - أدوات خطرة (shell, github_pr) تتطلب approval
  - UI banner: "Agent wants to run X — Approve?"
- [ ] **7.5** Tool versioning + testing (each tool has unit tests)
- [ ] **7.6** E2E tests (Playwright) للمسارات الحرجة
- [ ] **7.7** Multi-tenancy (tenant_id في كل جدول)
- [ ] **7.8** Sandbox resource limits (CPU/RAM/timeout per session)
- [ ] **7.9** Computer Use integration (Anthropic Computer Use / OpenAI Operator)

### 🟪 المرحلة 8 — UI Polish (P2)
> الهدف: تجربة Manus-level.

- [ ] **8.1** 3-pane layout: Sidebar | Chat | Workspace (الآن 2-pane)
- [ ] **8.2** Browser VNC live view (iframe يبث screenshot كل 500ms)
- [ ] **8.3** Terminal panel (xterm.js متصل بـ shell tool)
- [ ] **8.4** File tree browser في Workspace (شجرة ملفات sandbox)
- [ ] **8.5** Multi-tab chat (تبديل بين sessions بسرعة)
- [ ] **8.6** Voice input/output (Whisper + TTS)
- [ ] **8.7** Multi-modal artifacts (charts, maps, 3D)

---

## 🔑 مفاتيح API المطلوبة في Railway

| المتغيّر | الحاجة | المرحلة |
|---|---|---|
| `DATABASE_URL` | ✅ موجود | — |
| `REDIS_URL` | ✅ موجود | — |
| `OPENAI_API_KEY` | ✅ موجود | — |
| `ENCRYPTION_KEY` | ✅ موجود | — |
| `JWT_SECRET` | ⚠️ تحقق | 0.5 |
| `TAVILY_API_KEY` | ❌ مطلوب | 2.1 |
| `E2B_API_KEY` | ❌ مطلوب (مُفضّل) أو `TENSORLAKE_API_KEY` | 1.1 |
| `FAL_KEY` | ❌ اختياري | 6.1 |
| `BROWSERLESS_TOKEN` | ❌ اختياري | 2.3 |
| `FIRECRAWL_API_KEY` | ❌ اختياري | 2.2 |
| `GITHUB_TOKEN` | ❌ للتكامل | 6.6 |
| `GMAIL_CLIENT_ID` + `GMAIL_CLIENT_SECRET` | ❌ للتكامل | 6.7 |
| `NOTION_API_KEY` | ❌ للتكامل | 6.8 |
| `SLACK_BOT_TOKEN` | ❌ للتكامل | 6.9 |

---

## 🧰 أفضل تجميعة أدوات مقترحة (Best Tool Stack 2026)

```yaml
# Core Computer (Sandbox)
file_manager:      e2b_fs / tensorlake_fs   # Stateful per session
code_interpreter:  e2b / daytona            # Python + Node + Bash
shell:             e2b bash                 # Terminal streaming

# Web
web_search:        tavily_api               # $0 free tier, أفضل دقة
web_scrape:        jina_reader              # مجاني، markdown نظيف
browser:           playwright + browserless # Stateful context + screenshot

# AI / Creative
image_generation:  fal.ai /flux-schnell     # أسرع وأرخص من DALL-E
image_analyze:     gpt-4o / gemini vision
chart_generator:   matplotlib via code_interpreter

# RAG
rag_ingest:        langchain splitter + openai text-embedding-3-small + pgvector
rag_query:         pgvector cosine similarity

# Integrations
github:            octokit (PR + commit + review)
gmail:             googleapis
notion:            @notionhq/client
slack:             @slack/web-api

# Dev
postgres_query:    pg read-only + allowlist
git:               simple-git

# Memory
memory_search:     pgvector + embeddings
memory_store:      pgvector + embeddings
```

---

## 📊 جدول المقارنة مع Manus AI

| الميزة | Manus AI | مشروعنا الحالي | الهدف |
|---|---|---|---|
| Computer VM | ✅ كامل | ❌ لا يوجد | المرحلة 1 |
| Multi-Agent | ✅ 10+ sub-agents | ⚠️ 9 مفعّلين بدون handoff حقيقي | المرحلة 3 |
| Tools | 50+ | 8 (3 ضعيفة) | المراحل 1-6 |
| CodeAct | ✅ | ❌ | المرحلة 1.C |
| Browser Live | ✅ VNC | ❌ screenshot فقط | المرحلة 8.2 |
| Artifacts Live | ✅ | ⚠️ عرض فقط | المرحلة 1.E |
| File Workspace | ✅ persistent | ⚠️ DB فقط | المرحلة 1.B |
| RAG | ✅ | ❌ | المرحلة 5 |
| Image Gen | ✅ | ❌ | المرحلة 6.1 |
| Vision | ✅ | ❌ | المرحلة 6.5 |
| MCP | ✅ | ❌ | المرحلة 7.1 |
| Chat UI | ✅ 3-pane | ⚠️ 2-pane | المرحلة 8 |
| ReAct Loop | ✅ | ❌ single-step | المرحلة 3.5 |
| Background Workers | ✅ | ❌ sync HTTP | المرحلة 4 |

---

## 🧹 مستندات تم حذفها / تنظيف المشروع

### تم حذفها في 2026-06-22:
- ❌ `prisma/schema.prisma` — تضارب مع Drizzle (كان SQLite، المشروع PostgreSQL)
- ❌ `db/custom.db` — ملف SQLite مُلتزم في الريبو (تسريب محتمل)
- ❌ `@prisma/client` و `prisma` من `package.json` — غير مستخدمة فعلياً

### مستندات يتم الإبقاء عليها (مرجعية):
- ✅ `ARCHITECTURE.md` — المعمارية العامة (يُحدَّث)
- ✅ `AGENTS.md` — توثيق الوكلاء الـ 9
- ✅ `TOOLS.md` — توثيق الأدوات (سيُحدَّث بعد إضافة الجديدة)
- ✅ `API.md` — توثيق الـ API
- ✅ `DATABASE.md` — توثيق الـ schema
- ✅ `PROVIDERS.md` — توثيق الـ providers
- ✅ `MCP.md` — توثيق MCP (سيُحدَّث)
- ✅ `WORKFLOWS.md` — توثيق الـ workflows (سيُحدَّث)
- ✅ `MEMORY.md` — توثيق الذاكرة (سيُحدَّث)
- ✅ `README.md` — الواجهة العامة

### مستندات تم دمجها في هذا المرجع:
- 📥 `upload/المرحله الاولى.md` — تحليل الوكيل الأول (تركيز على Tensorlake + ReAct + Workers)
- 📥 `upload/المرحلة_الأولى.md` — تحليل الوكيل الثاني (تركيز على E2B + Tool ecosystem + 6 Sprints)
- 📥 `agent-ctx/phase-6-7-admin-resilience-main.md` — سجل المرحلة 6/7 (منجز بالفعل)
- 📥 `agent-ctx/manus-chat-ui-main.md` — سجل واجهة الدردشة (منجز بالفعل)

### مستندات قد تُحذف لاحقاً (مرحلة 7):
- ⚠️ `agent-ctx/` directory كله — بعد اكتمال كل المراحل، يمكن أرشفته

---

## 📝 سجل التحديثات (Changelog)

| التاريخ | المهمة | الحالة | Commit | ملاحظات |
|---|---|---|---|---|
| 2026-06-22 | 0.1 — حذف prisma/schema.prisma | ✅ | `e480fa3` | تنظيف |
| 2026-06-22 | 0.2 — إزالة @prisma/client من package.json | ✅ | `e480fa3` | تنظيف |
| 2026-06-22 | 0.3 — calculator XSS protection (whitelist regex) | ✅ | `feebe13` | أمن |
| 2026-06-22 | 0.4 — SSRF protection في http_request | ✅ | `feebe13` | أمن (block localhost/metadata IPs) |
| 2026-06-22 | 3.1 — تفعيل 9 وكلاء في DB | ✅ | SQL apply | تم سابقاً |
| 2026-06-22 | 3.2 — بناء AgentRouter | ✅ | `fb39555` | يعمل بـ Arabic+English |
| 2026-06-22 | 3.3 — إضافة agent_selected SSE event | ✅ | `fb39555` | — |
| 2026-06-22 | 3.4 — per-agent avatar في MessageBubble | ✅ | `fb39555` | 9 ألوان + أيقونات |
| 2026-06-22 | 3.5 — ReAct Loop في BaseAgent (multi-step) | ✅ | `feebe13` | maxSteps=20, self-correction |
| 2026-06-22 | 3.8 — role:'tool' بدل role:'user' hack | ✅ | `feebe13` | OpenAI standard + truncate |
| 2026-06-22 | 1.1 — Stateful Tensorlake Sandbox | ✅ | `281a263` | SandboxManager + DB metadata |
| 2026-06-22 | 1.2 — Sandbox cleanup on deleteSession | ✅ | `281a263` | terminate + clear metadata |
| 2026-06-22 | 1.4 — file_manager tool (read/write/list/edit/delete) | ✅ | `281a263` | Works on /home/tl-user |
| 2026-06-22 | 1.7 — code_execution (Python/JS/Bash) stateful | ✅ | `281a263` | Same sandbox per session |
| 2026-06-22 | 1.9 — pip/npm install via shell tool | ✅ | `281a263` | Persistent in sandbox |
| 2026-06-22 | 1.10 — shell tool (bash, persistent workDir) | ✅ | `281a263` | Blocks dangerous commands |
| 2026-06-22 | 2.1 — Tavily web_search (replaces DuckDuckGo) | ✅ | `281a263` | AI-optimized, topic+time filters |
| 2026-06-22 | 2.2 — web_scrape via Jina Reader | ✅ | `281a263` | Free, no API key, markdown output |
| 2026-06-22 | fix — await import() instead of require() | ✅ | `7004de2` | Fixed "t is not a constructor" |
| 2026-06-22 | fix — /home/tl-user (correct sandbox home) | ✅ | `2447930` | Was /home/user (doesn't exist) |
| 2026-06-22 | 2.4 — Tool Registry hardening (perms/rate/timeout/audit/cost) | ✅ | `58a3b7e` | Audit to audit_logs table |
| 2026-06-22 | 0.5 — JWT_SECRET verification (256-bit hex) | ✅ | verified | No change needed |
| 2026-06-22 | 0.6 — playwright → optionalDependencies | ✅ | `58a3b7e` | Saves ~200MB |
| 2026-06-22 | 0.7 — Remove unused z-ai-web-dev-sdk | ✅ | `58a3b7e` | Not used in src/ |
| 2026-06-22 | 0.9 — Rate limit on chat (30/min) + auth (5/min/IP) | ✅ | `58a3b7e` | 429 + Retry-After headers |
| 2026-06-22 | fix — audit_logs INSERT column count mismatch | ✅ | `7adc3ba` | Use NOW() for created_at |
| 2026-06-22 | 2.3 — Stateful browser tool (per-session context) | ✅ | `fad70b6` | 16 actions, idle cleanup, health check |
| 2026-06-22 | 1.8 — matplotlib chart → artifact detection | ✅ | `fad70b6` | Auto-detect png/csv/html/svg in sandbox |
| 2026-06-22 | 1.11 — Artifact live preview (HTML/CSV/SVG) | ✅ | `fad70b6` | iframe + table + inline SVG |
| — | باقي المهام | ⏳ | — | انظر الجداول أعلاه |

---

## 🎯 الأولويات القصوى التالية (Top 5 Next Actions)

1. ~~**المرحلة 3.5**: بناء ReAct Loop في BaseAgent~~ ✅ **تم** (commit `feebe13`)
2. ~~**المرحلة 1.A-D**: Stateful Sandbox + file_manager + shell + browser~~ ✅ **تم** (commits `281a263`, `2447930`, `fad70b6`)
3. ~~**المرحلة 2.1-2.4**: Tavily + Jina + stateful browser + tool registry hardening~~ ✅ **تم** (commits `281a263`, `58a3b7e`, `fad70b6`)
4. **المرحلة 4.1-4.2**: بناء background worker للمهام الطويلة (يمنع Railway timeout بعد 5 دقائق)
5. **المرحلة 5**: RAG + pgvector + embeddings (يتطلب OpenAI API key — مُعَدّ بالفعل)

---

*هذا المستند هو المرجع الوحيد. يُحدَّث بعد كل مهمة منجزة. آخر تحديث: 2026-06-22.*
