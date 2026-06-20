# Agent Platform — منصة الوكلاء السحابية

> منصة Agent سحابية احترافية مستوحاة من Manus — قابلة للتوسع، قابلة للصيانة، مناسبة للعمل الإنتاجي (Production Ready).

---

## 🎯 الحالة الراهنة (Phase 1 — مكتملة)

✅ **9 ملفات توثيق مرجعية** — ARCHITECTURE, DATABASE, AGENTS, PROVIDERS, TOOLS, MEMORY, WORKFLOWS, MCP, API
✅ **هيكل المشروع الكامل** — 19 وحدة مستقلة (modular) تمنع Circular Dependencies
✅ **Drizzle ORM Schema كامل** — 13 ملف schema لكل جداول PostgreSQL + pgvector
✅ **Core Types & Interfaces** — TypeScript types مشتركة + interfaces لكل وحدة
✅ **DI Container + EventBus** — فك ارتباط تام بين الوحدات
✅ **Auth (JWT + RBAC)** — Access/Refresh tokens + Role-based access control
✅ **Crypto utilities** — AES-256-GCM لتشفير API keys + JWT secret
✅ **BullMQ Queues** — 12 queue معرّفة للنظام
✅ **Redis client** — مع in-memory fallback للتجربة المحلية
✅ **Lifecycle Manager** — Graceful shutdown + signal handling
✅ **Circuit Breaker + Retry** — utilities للـ Resilience
✅ **Cost Tracker** — حساب وتسجيل تكلفة كل LLM call
✅ **لوحة تحكم أولية** — عرض المعمارية، الوحدات، الإجراءات اليدوية المطلوبة
✅ **API endpoints** — `/api/health` و `/api/system`

---

## 🏗️ المعمارية

**Clean Architecture + Modular Monolith**:

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
└──────────────────────────┬─────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────┐
│                  Infrastructure Layer                       │
│  PostgreSQL (Drizzle) · Redis (BullMQ) · S3 · External APIs │
└────────────────────────────────────────────────────────────┘
```

---

## 📚 حزمة التقنيات

| المكون | التقنية | السبب |
|--------|---------|------|
| Framework | Next.js 16 (App Router) | أحدث، SSR، API routes |
| Language | TypeScript 5 | type safety |
| Database | PostgreSQL 15+ | relational + JSON + pgvector |
| ORM | Drizzle ORM | SQL-first، أداء، دعم pgvector |
| Cache/Queue | Redis | سرعة + TTL |
| Jobs | BullMQ | retries، schedules، priorities |
| Vector | pgvector | DB واحدة، transactions |
| Validation | Zod | type inference |
| Logger | Pino | أسرع logger في Node.js |
| Auth | JWT + RBAC | stateless، قابل للتوسع |
| UI | shadcn/ui + Tailwind | modern، accessible |
| Deploy | Railway | بساطة + auto-scale |

---

## 📂 هيكل المشروع

```
src/
├── core/              # DI Container, EventBus, Lifecycle, Decorators
├── providers/         # LLM Providers (OpenAI, Anthropic, Gemini, Groq, Ollama, ...)
├── agents/            # 9 Agent Types + Handoffs + Sub-Agents
├── tools/             # Dynamic Tools + Registry + Permissions
├── memory/            # Short-term (Redis) + Long-term (pgvector)
├── context/           # Context Engine: ضغط، تلخيص، استخراج
├── workflows/         # DAG Engine: branches, conditions, parallel
├── mcp/               # MCP Client (stdio, sse, websocket, http)
├── background/        # BullMQ Queues + Workers
├── rag/               # RAG: Ingestion, Chunking, Embeddings
├── vector/            # pgvector Store + Index
├── storage/           # Local + S3 + Manager
├── integrations/      # GitHub, Slack, Notion, Discord, Email
├── config/            # Env, Constants, Feature Flags
├── auth/              # JWT, RBAC, Sessions
├── observability/     # Logger, Tracing, Metrics, Cost
├── api/               # Routes, Middleware, Validators
├── db/                # Drizzle Schema + Client + Redis
├── types/             # Shared TypeScript types
├── utils/             # crypto, retry, circuit-breaker
└── admin/             # Admin UI components
```

---

## 🚀 الإعداد السريع

### 1. تثبيت الاعتماديات
```bash
bun install
```

### 2. إعداد قاعدة البيانات
```bash
# على PostgreSQL (Railway, Docker, local):
psql $DATABASE_URL -f scripts/setup-database.sql
```

### 3. إعداد متغيرات البيئة
```bash
cp .env.example .env

# املأ القيم المطلوبة:
# - DATABASE_URL (postgresql://...)
# - REDIS_URL (redis://...)
# - ENCRYPTION_KEY (openssl rand -base64 32)
# - JWT_SECRET (openssl rand -hex 32)
```

### 4. تشغيل migrations
```bash
bun run db:generate
bun run db:migrate
```

### 5. تشغيل التطوير
```bash
bun run dev
```

---

## ⚠️ إجراءات يدوية مطلوبة (مهمة)

1. **إنشاء PostgreSQL database** على Railway أو محلياً
2. **تشغيل `scripts/setup-database.sql`** لتفعيل pgvector + uuid-ossp
3. **إنشاء Redis instance** على Railway أو محلياً
4. **توليد `ENCRYPTION_KEY`**: `openssl rand -base64 32`
5. **توليد `JWT_SECRET`**: `openssl rand -hex 32`
6. **(بعد الإقلاع) إضافة المزودين** من لوحة التحكم → Providers → Add Provider
7. **(بعد الإقلاع) إضافة النماذج** عبر زر "Refresh Models" لكل مزود

---

## 📖 التوثيق

| الملف | المحتوى |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | التصميم المعماري الكامل |
| [DATABASE.md](./DATABASE.md) | مخطط قاعدة البيانات |
| [AGENTS.md](./AGENTS.md) | نظام الوكلاء |
| [PROVIDERS.md](./PROVIDERS.md) | نظام المزودين |
| [TOOLS.md](./TOOLS.md) | نظام الأدوات |
| [MEMORY.md](./MEMORY.md) | نظام الذاكرة |
| [WORKFLOWS.md](./WORKFLOWS.md) | محرك Workflows |
| [MCP.md](./MCP.md) | بروتوكول MCP |
| [API.md](./API.md) | REST API |

---

## 🎯 المراحل

| # | المرحلة | الحالة |
|---|---------|------|
| 1 | المعمارية + التوثيق + DB Schema + Core Types | ✅ مكتملة |
| 2 | Core Implementation: Providers/Memory/Auth | ⏳ التالية |
| 3 | Agents System: 9 وكلاء + Handoffs | ⏳ |
| 4 | Tools + MCP + RAG | ⏳ |
| 5 | Workflows + Background Jobs | ⏳ |
| 6 | Admin UI + Observability | ⏳ |
| 7 | Resilience + Tests + Railway Deploy | ⏳ |

**القاعدة**: لا ننتقل للمرحلة التالية قبل استقرار الحالية.

---

## 🔌 API Endpoints (الأساسية)

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/api/health` | فحص صحة النظام |
| `GET` | `/api/system` | معلومات النظام والوحدات |

(REST API الكامل سيُبنى في المرحلة 6 — راجع `API.md`)

---

## 🛣️ التوسع المستقبلي

- 🎙️ الصوت (Audio)
- 👁️ الرؤية (Vision)
- 🌐 Browser Automation
- 💻 Computer Use
- 📱 Mobile Apps (REST API جاهز)
- 🏢 Multi-Tenancy
- 🛒 Marketplace للإضافات
