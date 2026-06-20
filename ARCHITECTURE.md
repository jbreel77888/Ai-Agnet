# ARCHITECTURE — منصة الوكلاء السحابية (Manus-inspired)

> الوثيقة المرجعية للمعمارية الكاملة للمنصة. يجب قراءتها قبل أي تعديل على بنية المشروع.

---

## 1. الفلسفة المعمارية

تعتمد المنصة على المبادئ التالية:

| المبدأ | التطبيق |
|--------|---------|
| **Clean Architecture** | فصل طبقات: Domain ← Application ← Infrastructure ← Presentation |
| **Modular Monolith** | وحدات مستقلة منطقياً، تشارك نفس العملية، قابلة للفصل لاحقاً إلى Microservices |
| **Dependency Inversion** | الوحدات العليا تعتمد على Interfaces، لا على Implementations |
| **Dependency Injection** | حاوية DI مركزية تربط كل شيء في وقت التشغيل |
| **Zero Circular Dependencies** | يُمنع استيراد وحدة من أخرى بشكل دائري؛ يتم استخدام EventBus أو Shared Kernel |
| **Configuration as Data** | كل المزودين/النماذج/الأدوات/الوكلاء مخزنة في DB وقابلة للإدارة من لوحة التحكم |
| **Production-First** | Resilience (Circuit Breakers, Retries, Fallbacks) من اليوم الأول |

---

## 2. الطبقات (Layers)

```
┌────────────────────────────────────────────────────────────┐
│                    Presentation Layer                       │
│  Next.js App Router · Admin UI · REST API · WebSocket      │
└──────────────────────────┬─────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────┐
│                   Application Layer                         │
│  Use Cases · Orchestrators · Workflows · Agent Handoffs    │
└──────────────────────────┬─────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────┐
│                     Domain Layer                            │
│  Entities · Value Objects · Domain Events · Pure Logic     │
│  (لا اعتماد على إطار عمل — TypeScript نقي)                  │
└──────────────────────────┬─────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────┐
│                  Infrastructure Layer                       │
│  PostgreSQL (Drizzle) · Redis (BullMQ) · S3 · External APIs │
└────────────────────────────────────────────────────────────┘
```

---

## 3. الخريطة الشاملة للوحدات

```
src/
├── core/              # النواة: DI، EventBus، Lifecycle، Errors، Decorators
├── providers/         # مزودي LLM (OpenAI, Anthropic, Gemini, Groq, Ollama, OpenRouter, Custom)
├── agents/            # الوكلاء: Planner, Research, Reasoning, Coding, Execution, Tool, Memory, Reflection, Summarizer
├── tools/             # الأدوات الديناميكية + Registry + Permissions
├── memory/            # Short-term (Redis) + Long-term (pgvector) + Compression
├── context/           # Context Engine: ضغط، تلخيص، استخراج كيانات
├── workflows/         # محرك Workflows: branches, conditions, parallel, retry, timeouts
├── mcp/               # MCP Client: اتصال بـ MCP Servers وإدارة أدواتها
├── background/        # BullMQ Queues + Workers + Scheduler
├── rag/               # RAG: Ingestion, Chunking, Embeddings, Retrieval
├── vector/            # pgvector Store + Index Management
├── storage/           # File Storage: Local + S3 + Manager
├── integrations/      # GitHub, Slack, Notion, Discord, Email
├── config/            # Env loading, Constants, Feature Flags
├── auth/              # JWT, Refresh Tokens, RBAC (Admin/Operator/User), Sessions
├── observability/     # Logger (Pino), Tracing (OTel), Metrics, Cost Tracking, Health
├── api/               # REST API Routes + Middleware + Validators (Zod)
├── db/                # Drizzle Schema + Client + Migrations (PostgreSQL + pgvector)
├── types/             # TypeScript Types مشتركة بين كل الوحدات
├── utils/             # Helpers (crypto, time, string, retry, circuit-breaker)
└── admin/             # مكونات لوحة التحكم + الأقسام
```

---

## 4. تبعيات الوحدات (Module Dependencies)

```
                    ┌──────────┐
                    │   core   │ ← (لا يعتمد على شيء)
                    └────┬─────┘
        ┌────────────────┼─────────────────┐
        ▼                ▼                 ▼
   ┌─────────┐     ┌──────────┐      ┌──────────┐
   │  config │     │   types  │      │   utils  │
   └────┬────┘     └──────────┘      └──────────┘
        │
        ▼
   ┌─────────┐
   │   db    │ ← (Drizzle Client + Schema)
   └────┬────┘
        │
        ▼
   ┌─────────────┐     ┌──────────┐     ┌────────────┐
   │ observability│     │  memory  │     │  storage   │
   └──────┬──────┘     └────┬─────┘     └─────┬──────┘
          │                 │                  │
          └────────┬────────┴──────────┬───────┘
                   ▼                   ▼
              ┌─────────┐         ┌─────────┐
              │providers│         │   mcp   │
              └────┬────┘         └────┬────┘
                   │                   │
                   └─────────┬─────────┘
                             ▼
                        ┌─────────┐
                        │  tools  │
                        └────┬────┘
                             ▼
                        ┌─────────┐
                        │  agents │
                        └────┬────┘
                             ▼
                  ┌──────────┴──────────┐
                  ▼                     ▼
            ┌──────────┐          ┌────────────┐
            │workflows │          │ background │
            └────┬─────┘          └─────┬──────┘
                 │                      │
                 └──────────┬───────────┘
                            ▼
                       ┌─────────┐
                       │ context │
                       └────┬────┘
                            ▼
                       ┌─────────┐
                       │   api   │
                       └────┬────┘
                            ▼
                       ┌─────────┐
                       │  admin  │
                       └─────────┘
```

**القاعدة الذهبية**: السهم يشير إلى اتجاه الاعتماد. لا يُسمح أبداً بالاعتماد العكسي.

---

## 5. حاوية Dependency Injection

كل وحدة تصدّر `Token` (Symbol) و`Provider`. الحاوية المركزية تربطها:

```typescript
// مثال: providers/registry/tokens.ts
export const PROVIDER_MANAGER = Symbol('PROVIDER_MANAGER');
export const LLM_CLIENT_FACTORY = Symbol('LLM_CLIENT_FACTORY');

// مثال: agents/registry/tokens.ts
export const AGENT_REGISTRY = Symbol('AGENT_REGISTRY');
export const AGENT_ORCHESTRATOR = Symbol('AGENT_ORCHESTRATOR');
```

الـ Composition Root في `src/core/container.ts` ينشئ كل شيء في وقت الإقلاع.

---

## 6. EventBus المركزي

يُستخدم لفك الارتباط بين الوحدات (منع Circular Dependencies):

```typescript
// core/events/EventBus.ts
eventBus.emit('agent.message.created', { agentId, sessionId, message });
eventBus.on('cost.token.used', (e) => costTracker.record(e));
```

---

## 7. نمط البيانات عبر قاعدة البيانات

كل الكيانات القابلة للإدارة من لوحة التحكم (مزودين، نماذج، أدوات، وكلاء، MCP) مخزنة في PostgreSQL مع schema كامل في `src/db/schema/`. راجع `DATABASE.md`.

---

## 8. الاعتمادية والاستقرار (Resilience)

| النمط | الموقع | الوصف |
|-------|--------|-------|
| **Timeout** | `utils/retry.ts` | مهلة زمنية لكل طلب LLM/Tool |
| **Retry** | `utils/retry.ts` | exponential backoff مع jitter |
| **Fallback Model** | `providers/manager/fallback.ts` | التحويل لنموذج بديل عند فشل الأساسي |
| **Circuit Breaker** | `utils/circuit-breaker.ts` | فتح الدائرة بعد N فشل متتالٍ |
| **Graceful Shutdown** | `core/lifecycle/shutdown.ts` | إغلاق Workers وConnections بأمان |

---

## 9. دورة حياة الطلب (Request Lifecycle)

```
HTTP Request
   ↓
Auth Middleware (JWT verification + RBAC check)
   ↓
Rate Limiter (Redis-based)
   ↓
Request Validator (Zod schema)
   ↓
Controller (api/routes/)
   ↓
Use Case / Orchestrator
   ↓
Agent / Workflow / Tool (مع observability)
   ↓
Response (JSON / SSE Stream)
   ↓
Logging + Tracing + Cost Recording (async via EventBus)
```

---

## 10. التوسع المستقبلي

| الميزة | كيف نستوعبها مستقبلاً |
|--------|----------------------|
| **Audio** | إضافة `audio/` module + Provider capability `audio: true` |
| **Vision** | Provider capability `vision: true` + Message type `image` |
| **Browser Automation** | `tools/builtin/browser.ts` + Playwright worker في `background/` |
| **Computer Use** | `tools/builtin/computer-use.ts` (Anthropic Computer Use API) |
| **Mobile Apps** | REST API جاهز للاستهلاك من أي عميل |
| **Multi-Tenancy** | عمود `tenantId` في كل جدول + RLS في PostgreSQL |
| **Marketplace** | جدول `plugins` + نظام Manifest + Sandbox للتنفيذ |

---

## 11. قرارات معمارية رئيسية

| القرار | السبب |
|--------|------|
| **Modular Monolith بدلاً من Microservices** | بساطة التطوير أول سنة، إمكانية الفصل لاحقاً |
| **Drizzle بدلاً من Prisma** | أداء أعلى، SQL-first، دعم pgvector أصلي |
| **BullMQ بدلاً من قائمة مخصصة** | ناضج، يدعم Retries/Schedules/Priorities |
| **Redis للذاكرة قصيرة المدى** | زمن وصول < 1ms، TTL تلقائي |
| **pgvector بدلاً من Pinecone/Weaviate** | قاعدة بيانات واحدة، transactions، أقل تكلفة |
| **EventBus بدلاً من RPC بين الوحدات** | فك ارتباط، سهولة الاختبار |
| **Zod للتحقق** | type inference، أداء، شائع |
| **Pino للتسجيل** | أسرع logger في Node.js، structured JSON |

---

## 12. المراحل

| المرحلة | النطاق | الحالة |
|---------|--------|--------|
| 1 | المعمارية + التوثيق + DB Schema + Core Types | 🟢 جارية |
| 2 | Core/Providers/Memory/Auth + DI Container | ⏳ معلقة |
| 3 | Agents System + Handoffs | ⏳ معلقة |
| 4 | Tools + MCP + RAG | ⏳ معلقة |
| 5 | Workflows + Background Jobs + Sessions | ⏳ معلقة |
| 6 | Admin UI + Observability + Cost Tracking | ⏳ معلقة |
| 7 | Resilience + Tests + Railway Deploy | ⏳ معلقة |
