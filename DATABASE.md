# DATABASE — مخطط قاعدة البيانات الكامل

> PostgreSQL 15+ مع امتداد `pgvector` و`uuid-ossp`. كل المخططات مكتوبة بـ Drizzle ORM.

---

## 1. الإعداد الأولي

```sql
-- ينفذ يدوياً على خادم PostgreSQL (Railway أو غيره):
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";       -- pgvector
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- بحث نصي سريع
```

**متغيرات البيئة المطلوبة:**
```
DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require
REDIS_URL=redis://default:pass@host:6379
```

---

## 2. المخططات (Schemas) — نظرة عامة

| المجموعة | الجداول |
|----------|---------|
| **Auth** | users, sessions, refresh_tokens, roles, permissions, role_permissions, user_roles |
| **Providers** | providers, models |
| **Agents** | agents, agent_tools, agent_models |
| **Tools** | tools, tool_permissions |
| **MCP** | mcp_servers, mcp_tools |
| **Memory** | memory_short, memory_long, memory_facts, memory_entities, memory_summaries |
| **Sessions** | sessions_agent, messages, artifacts, tool_calls |
| **Workflows** | workflows, workflow_runs, workflow_steps, workflow_step_runs |
| **RAG** | documents, document_chunks, embeddings |
| **Background** | job_records, job_logs |
| **Cost** | cost_records, cost_budgets |
| **Observability** | traces, metrics, audit_logs |
| **Storage** | storage_objects |
| **Integrations** | integrations, integration_credentials |

---

## 3. المواصفات التفصيلية

### 3.1 Auth & RBAC

```typescript
// users
{
  id: uuid PK
  email: text unique not null
  password_hash: text not null          // bcrypt
  name: text
  avatar_url: text
  status: enum('active','suspended','deleted') default 'active'
  last_login_at: timestamptz
  created_at, updated_at: timestamptz
}

// roles
{ id: uuid PK, name: text unique, description: text, is_system: boolean }

// permissions
{ id: uuid PK, name: text unique, resource: text, action: text }

// role_permissions (many-to-many)
{ role_id FK, permission_id FK, PK(role_id, permission_id) }

// user_roles (many-to-many)
{ user_id FK, role_id FK, PK(user_id, role_id) }

// refresh_tokens
{
  id: uuid PK
  user_id FK
  token_hash: text unique not null
  expires_at: timestamptz
  revoked_at: timestamptz
  device_info: jsonb
  created_at: timestamptz
}
```

**الأدوار النظامية**: `admin` (كل الصلاحيات) · `operator` (إدارة الوكلاء/الجلسات) · `user` (استخدام فقط).

### 3.2 Providers & Models

```typescript
// providers
{
  id: uuid PK
  name: text not null                    // "OpenAI", "Anthropic"...
  slug: text unique not null
  type: enum('openai','anthropic','gemini','groq','ollama','openrouter','openai_compatible','custom')
  base_url: text not null
  api_key_encrypted: text                // مشفر AES-256
  headers: jsonb                         // headers مخصصة
  status: enum('active','inactive','error') default 'active'
  timeout_ms: integer default 30000
  max_retries: integer default 3
  metadata: jsonb                        // معلومات إضافية
  health_check_at: timestamptz
  health_status: enum('healthy','degraded','down','unknown') default 'unknown'
  created_at, updated_at
}

// models
{
  id: uuid PK
  provider_id FK -> providers.id
  name: text not null                    // "gpt-4o", "claude-3-5-sonnet"
  display_name: text
  input_price_per_1k: numeric(10,6)      // سعر بالدولار
  output_price_per_1k: numeric(10,6)
  context_window: integer                // tokens
  max_output_tokens: integer
  supports_tools: boolean default false
  supports_vision: boolean default false
  supports_streaming: boolean default false
  supports_thinking: boolean default false
  priority: integer default 100          // الأقل = أولوية أعلى
  status: enum('active','deprecated','inactive') default 'active'
  metadata: jsonb
  created_at, updated_at
  UNIQUE(provider_id, name)
}
```

### 3.3 Agents

```typescript
// agents
{
  id: uuid PK
  name: text not null                    // "Planner", "Researcher"...
  slug: text unique not null
  type: enum('planner','research','reasoning','coding','execution','tool','memory','reflection','summarizer','custom')
  system_prompt: text
  description: text
  default_model_id FK -> models.id
  temperature: numeric(3,2) default 0.7
  max_tokens: integer default 4096
  top_p: numeric(3,2) default 1.0
  enabled: boolean default true
  can_spawn_subagents: boolean default false
  max_subagents: integer default 0
  parent_agent_id FK -> agents.id        // للوكلاء الفرعيين
  handoff_targets: jsonb                 // [agentSlug, ...]
  metadata: jsonb
  created_at, updated_at
}

// agent_tools (many-to-many)
{ agent_id FK, tool_id FK, PK(agent_id, tool_id) }

// agent_models (fallback chain)
{
  id: uuid PK
  agent_id FK
  model_id FK
  priority: integer                      // 1 = primary, 2 = fallback 1...
  PK priority unique per agent
}
```

### 3.4 Tools

```typescript
// tools
{
  id: uuid PK
  name: text unique not null             // "web_search", "github.create_issue"
  display_name: text
  description: text not null
  category: enum('builtin','integration','mcp','custom')
  source: enum('internal','mcp')         // مصدر الأداة
  mcp_server_id FK nullable
  schema: jsonb not null                 // JSON Schema للمعاملات
  handler_path: text                     // لل内置 tools: مسار المعالج
  required_permissions: text[]           // ["tools:execute:web"]
  enabled: boolean default true
  rate_limit_per_min: integer default 60
  timeout_ms: integer default 30000
  metadata: jsonb
  created_at, updated_at
}

// tool_permissions
{
  id: uuid PK
  tool_id FK
  role_id FK
  allowed: boolean default true
  constraints: jsonb                     // قيود إضافية
  PK(tool_id, role_id)
}
```

### 3.5 MCP

```typescript
// mcp_servers
{
  id: uuid PK
  name: text not null
  slug: text unique not null
  transport: enum('stdio','sse','websocket','http')
  command: text                          // لـ stdio
  args: jsonb
  url: text                              // لـ sse/ws/http
  auth_type: enum('none','bearer','basic','api_key')
  auth_credentials_encrypted: text
  env_vars_encrypted: jsonb
  status: enum('active','inactive','error') default 'inactive'
  last_sync_at: timestamptz
  tools_count: integer default 0
  metadata: jsonb
  created_at, updated_at
}

// mcp_tools (cached من MCP server)
{
  id: uuid PK
  mcp_server_id FK
  external_name: text                    // الاسم كما يرد من MCP
  display_name: text
  description: text
  schema: jsonb
  last_seen_at: timestamptz
  PK(mcp_server_id, external_name)
}
```

### 3.6 Memory

```typescript
// memory_short (Redis في الإنتاج، لكن نسخة احتياطية هنا)
{
  id: uuid PK
  session_id: uuid
  role: enum('user','assistant','system','tool')
  content: text
  tokens: integer
  metadata: jsonb
  expires_at: timestamptz                // TTL
  created_at: timestamptz
}

// memory_long (حقائق طويلة المدى)
{
  id: uuid PK
  user_id FK nullable
  agent_id FK nullable
  session_id FK nullable
  fact: text not null
  fact_type: enum('preference','entity','event','summary','custom')
  importance: numeric(3,2) default 0.5   // 0-1
  embedding: vector(1536)                // pgvector
  metadata: jsonb
  last_accessed_at: timestamptz
  access_count: integer default 0
  created_at, updated_at
}
INDEX: ivfflat on embedding USING cosine

// memory_entities (كيانات مستخرجة)
{
  id: uuid PK
  user_id FK nullable
  entity_type: text                      // "person", "project", "concept"
  entity_value: text
  canonical: text
  aliases: text[]
  embedding: vector(1536)
  metadata: jsonb
  created_at, updated_at
  UNIQUE(entity_type, canonical)
}

// memory_summaries (ملخصات تلقائية للجلسات)
{
  id: uuid PK
  session_id FK
  agent_id FK
  summary: text not null
  tokens_saved: integer
  covered_message_ids: uuid[]
  embedding: vector(1536)
  created_at
}
```

### 3.7 Sessions & Messages

```typescript
// sessions_agent (جلسات الوكلاء)
{
  id: uuid PK
  user_id FK
  agent_id FK
  title: text
  status: enum('active','paused','completed','failed','archived')
  parent_session_id FK nullable          // للجلسات الفرعية
  workflow_run_id FK nullable
  context_summary: text                  // ملخص السياق الحالي
  total_tokens: integer default 0
  total_cost: numeric(10,4) default 0
  metadata: jsonb
  started_at, completed_at, last_activity_at
  created_at, updated_at
}

// messages
{
  id: uuid PK
  session_id FK
  role: enum('user','assistant','system','tool','error')
  content: text                          // للمحتوى النصي
  content_blocks: jsonb                  // [{type:'text'|'image'|'tool_use'|'tool_result'}]
  model_id FK nullable
  parent_message_id FK nullable          // للتفريعات
  tokens_input: integer
  tokens_output: integer
  cost: numeric(10,6)
  latency_ms: integer
  tool_calls: jsonb                      // [{tool, args, result}]
  finish_reason: text
  metadata: jsonb
  created_at
}
INDEX: (session_id, created_at)

// artifacts (مخرجات الجلسة: ملفات، تقارير، صور)
{
  id: uuid PK
  session_id FK
  message_id FK nullable
  name: text
  type: enum('file','image','code','report','data')
  storage_key: text                      // المسار في storage layer
  mime_type: text
  size_bytes: bigint
  metadata: jsonb
  created_at
}

// tool_calls (سجل مستقل لكل استدعاء أداة)
{
  id: uuid PK
  session_id FK
  message_id FK nullable
  tool_id FK
  tool_name: text
  arguments: jsonb
  result: jsonb
  status: enum('pending','running','success','failed','timeout')
  error: text
  started_at, completed_at
  duration_ms: integer
  cost: numeric(10,6) default 0
}
```

### 3.8 Workflows

```typescript
// workflows (تعريف ساكن)
{
  id: uuid PK
  name: text unique
  description: text
  version: integer default 1
  definition: jsonb                      // رسم بياني: nodes + edges
  trigger_type: enum('manual','webhook','schedule','event')
  trigger_config: jsonb
  enabled: boolean default true
  created_at, updated_at
}

// workflow_runs (تنفيذ محدد)
{
  id: uuid PK
  workflow_id FK
  session_id FK nullable
  status: enum('pending','running','paused','completed','failed','cancelled')
  input: jsonb
  output: jsonb
  context: jsonb                         // حالة مشتركة بين الخطوات
  current_step_id FK nullable
  error: text
  started_at, completed_at
  created_at
}

// workflow_step_runs
{
  id: uuid PK
  workflow_run_id FK
  step_id: text                          // معرّف الخطوة في التعريف
  step_type: enum('agent','tool','condition','parallel','delay','code','handoff')
  status: enum('pending','running','completed','failed','skipped')
  input: jsonb
  output: jsonb
  attempts: integer default 0
  error: text
  started_at, completed_at
}
```

### 3.9 RAG

```typescript
// documents
{
  id: uuid PK
  user_id FK nullable
  name: text
  source_type: enum('upload','url','api','integration')
  source_url: text
  mime_type: text
  size_bytes: bigint
  content_hash: text                     // لتجنب التكرار
  status: enum('pending','processing','ready','failed')
  metadata: jsonb
  created_at, updated_at
}

// document_chunks
{
  id: uuid PK
  document_id FK
  chunk_index: integer
  content: text not null
  tokens: integer
  embedding: vector(1536)
  metadata: jsonb                        // {page, section, bbox...}
  created_at
  INDEX: ivfflat on embedding USING cosine
}
```

### 3.10 Background Jobs & Cost

```typescript
// job_records (سجل BullMQ — يتم مزامنته بشكل دوري)
{
  id: uuid PK
  queue_name: text
  job_id: text                           // BullMQ job ID
  job_type: text
  payload: jsonb
  status: enum('waiting','active','completed','failed','delayed','paused')
  attempts: integer
  max_attempts: integer
  progress: integer default 0
  error: text
  started_at, completed_at
  created_at
}

// cost_records
{
  id: uuid PK
  user_id FK
  session_id FK nullable
  agent_id FK nullable
  model_id FK nullable
  provider_id FK nullable
  tokens_input: integer
  tokens_output: integer
  cost: numeric(10,6) not null
  currency: text default 'USD'
  recorded_at: timestamptz
  INDEX: (user_id, recorded_at)
}

// cost_budgets (حدود التكلفة)
{
  id: uuid PK
  user_id FK
  scope: enum('user','session','agent','global')
  scope_id: uuid nullable
  period: enum('daily','weekly','monthly','total')
  limit_usd: numeric(10,2)
  spent_usd: numeric(10,2) default 0
  reset_at: timestamptz
  action: enum('warn','block','notify')
  enabled: boolean default true
}
```

### 3.11 Observability & Audit

```typescript
// traces (OpenTelemetry-style)
{
  id: uuid PK
  trace_id: text
  span_id: text
  parent_span_id: text nullable
  name: text
  kind: enum('internal','client','server','producer','consumer')
  start_time: timestamptz
  end_time: timestamptz
  duration_ms: integer
  attributes: jsonb
  status: enum('ok','error','unset')
  events: jsonb
  resource: jsonb
  INDEX: (trace_id)
}

// audit_logs (كل العمليات الحساسة)
{
  id: uuid PK
  user_id FK nullable
  action: text                           // "provider.create", "user.login"
  resource_type: text
  resource_id: text nullable
  before: jsonb
  after: jsonb
  ip_address: inet
  user_agent: text
  created_at
  INDEX: (resource_type, resource_id)
}

// metrics (نقاط بيانات)
{
  id: uuid PK
  name: text
  value: numeric
  unit: text
  tags: jsonb
  recorded_at: timestamptz
  INDEX: (name, recorded_at)
}
```

### 3.12 Storage

```typescript
// storage_objects
{
  id: uuid PK
  owner_id FK nullable
  key: text unique                       // المسار الكامل
  bucket: text default 'default'
  backend: enum('local','s3','r2','gcs')
  content_type: text
  size_bytes: bigint
  checksum: text
  metadata: jsonb
  is_public: boolean default false
  expires_at: timestamptz nullable
  created_at, updated_at
}
```

### 3.13 Integrations

```typescript
// integrations (تكوينات الجاهزية)
{
  id: uuid PK
  name: text not null
  type: enum('github','slack','notion','discord','email','custom')
  status: enum('connected','disconnected','error')
  config: jsonb                          // بدون أسرار
  credentials_encrypted: jsonb           // الأسرار
  last_sync_at: timestamptz
  created_at, updated_at
}
```

---

## 4. التشفير

كل القيم الحساسة (API keys، credentials) مشفرة بـ AES-256-GCM باستخدام مفتاح من `ENCRYPTION_KEY` (32 bytes base64). راجع `src/utils/crypto.ts`.

---

## 5. الفهارس (Indexes)

الفهارس الأساسية:
- `messages(session_id, created_at)` — استرجاع رسائل الجلسة
- `memory_long.embedding` — ivfflat cosine
- `document_chunks.embedding` — ivfflat cosine
- `cost_records(user_id, recorded_at)` — تقارير التكلفة
- `traces(trace_id)` — استرجاع trace كامل
- `audit_logs(resource_type, resource_id)` — تدقيق كيان

---

## 6. الترحيلات (Migrations)

يستخدم Drizzle Kit:
```bash
bun run db:generate   # توليد migration من التغييرات
bun run db:migrate    # تطبيق migrations
bun run db:studio     # واجهة ويب للفحص
```

---

## 7. النسخ الاحتياطي

- **يومي**: `pg_dump` كامل → S3/R2
- **Redis**: RDB كل ساعة + AOF
- **الاسترجاع**: نقطة استرجاع خلال 24 ساعة كحد أقصى
