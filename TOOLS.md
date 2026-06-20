# TOOLS — نظام الأدوات الديناميكي

> وثيقة تصميم نظام الأدوات: التسجيل، الصلاحيات، التنفيذ، الإضافة الديناميكية.

---

## 1. الفلسفة

- كل أداة هي **وحدة قابلة للاكتشاف والتشغيل** عبر واجهة موحّدة.
- الأدوات **ديناميكية**: تُضاف من لوحة التحكم أو من MCP Servers بدون إعادة تشغيل.
- الأمان أولاً: كل أداة لها **صلاحيات** و**قيود** و**rate limits** و**timeout**.
- التنفيذ **معزول** قدر الإمكان: نتائج الأدوات لا تُمرَّر مباشرة لـ LLM دون تنظيف.

---

## 2. الأدوات المدعومة (Built-in)

| الاسم | الفئة | الوصف |
|------|------|------|
| `web_search` | builtin | بحث على الويب (Tavily/SerpAPI/Brave قابل للتبديل) |
| `browser` | builtin | Browser automation (Playwright) |
| `github` | integration | Issues, PRs, Repos (read/write) |
| `filesystem` | builtin | قراءة/كتابة ملفات في مسار محجوز |
| `postgres_query` | builtin | تنفيذ SQL read-only على DB المنصة |
| `redis_command` | builtin | GET/SET/DELETE على Redis |
| `email` | integration | إرسال/قراءة بريد (SMTP/IMAP) |
| `slack` | integration | رسائل، قنوات، ملفات |
| `discord` | integration | رسائل، خوادم |
| `notion` | integration | صفحات، قواعد بيانات |
| `http_request` | builtin | HTTP عام (GET/POST/...) |
| `code_execution` | builtin | تنفيذ JavaScript/Python في sandbox |
| `calculator` | builtin | عمليات رياضية دقيقة |
| `memory_search` | builtin | بحث في الذاكرة طويلة المدى |
| `memory_store` | builtin | تخزين حقيقة في الذاكرة |
| `rag_query` | builtin | استعلام على مستندات RAG |
| `image_generation` | builtin | توليد صور (DALL-E/Stable Diffusion) |

---

## 3. الـ Base Tool Interface

```typescript
interface ITool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly schema: JSONSchema;            // معاملات الإدخال
  readonly category: ToolCategory;

  // دورة الحياة
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // التنفيذ
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
  validate(args: unknown): { valid: boolean; errors?: string[] };

  // الاكتشاف
  getCapabilities(): ToolCapabilities;
}

interface ToolContext {
  userId: string;
  sessionId: string;
  agentId: string;
  permissions: Permission[];
  rateLimiter: RateLimiter;
  logger: Logger;
  tracer: Tracer;
  audit: AuditLogger;
  storage: StorageManager;
  secrets: SecretResolver;        // للوصول لـ API keys بأمان
}

interface ToolResult {
  success: boolean;
  data?: unknown;                // JSON-serializable
  error?: { code: string; message: string; details?: any };
  metadata?: {
    durationMs: number;
    cost?: number;
    tokensUsed?: number;
    artifacts?: { name: string; storageKey: string }[];
  };
}
```

---

## 4. JSON Schema للأدوات

كل أداة تُصرّح schema للمعاملات (متوافق مع OpenAI function calling):

```typescript
// مثال: web_search
{
  name: "web_search",
  description: "Search the web for current information",
  schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      max_results: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      time_range: { type: "string", enum: ["day", "week", "month", "year", "any"], default: "any" }
    },
    required: ["query"],
    additionalProperties: false
  }
}
```

---

## 5. Tool Registry

نقطة الدخول المركزية لاكتشاف الأدوات:

```typescript
interface ToolRegistry {
  register(tool: ITool): void;
  unregister(name: string): void;
  get(name: string): ITool | undefined;
  list(filter?: ToolFilter): ToolDescriptor[];

  // للوكلاء/LLM
  toOpenAITools(allowedNames: string[]): OpenAITool[];
  toAnthropicTools(allowedNames: string[]): AnthropicTool[];

  // إعادة تحميل ديناميكي
  reloadFromDB(): Promise<void>;
  reloadMCPTools(serverId: string): Promise<void>;

  // الأحداث
  on(event: 'tool_registered' | 'tool_unregistered', cb: (tool: ITool) => void): void;
}
```

---

## 6. الصلاحيات (Permissions)

### نموذج RBAC الموسّع للأدوات

```typescript
// tool_permissions
{
  toolId: string;
  roleId: string;
  allowed: boolean;
  constraints: {
    maxCallsPerSession?: number;
    maxCallsPerDay?: number;
    requireApproval?: boolean;          // موافقة بشرية قبل التنفيذ
    allowedArgs?: Partial<JSONSchema>;  // قيود على الـ args
    deniedArgs?: string[];              // حقول ممنوعة في args
  };
}
```

### أمثلة

- `user` role + `filesystem` tool → ممنوع (default)
- `operator` role + `filesystem` tool → مسموح، لكن `deniedArgs: ['/etc', '/root']`
- `admin` role + `code_execution` tool → مسموح
- `user` role + `code_execution` tool → مسموح، لكن `requireApproval: true`

### التحقق وقت التنفيذ

```typescript
async function executeTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  // 1. الوجود
  const tool = registry.get(name);
  if (!tool) throw new ToolNotFoundError(name);

  // 2. الصلاحية
  const perm = await checkPermission(ctx.userId, ctx.roleId, name);
  if (!perm.allowed) throw new PermissionDeniedError(name);

  // 3. القيود على الـ args
  validateConstraints(args, perm.constraints);

  // 4. Rate limit
  await ctx.rateLimiter.consume(`${name}:${ctx.userId}`);

  // 5. الموافقة البشرية (إن لزم)
  if (perm.constraints.requireApproval) {
    await requestHumanApproval(name, args, ctx);
  }

  // 6. التحقق من الـ schema
  const validation = tool.validate(args);
  if (!validation.valid) throw new InvalidArgsError(validation.errors);

  // 7. التنفيذ مع timeout
  return await withTimeout(() => tool.execute(args, ctx), tool.timeoutMs);
}
```

---

## 7. Human-in-the-Loop

بعض الأدوات تتطلب موافقة بشرية قبل التنفيذ:

```typescript
// Workflows:
// 1. الطلب يدخل قائمة انتظار الموافقات (approvals table)
// 2. المستخدم/الأدمن يرى الطلب في لوحة التحكم
// 3. يوافق/يرفض → يُستأنف التنفيذ

interface ApprovalRequest {
  id: string;
  sessionId: string;
  agentId: string;
  toolName: string;
  args: unknown;
  requestedAt: Date;
  expiresAt: Date;             // افتراضياً +24h
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  decidedBy?: string;
  decidedAt?: Date;
  reason?: string;
}
```

---

## 8. إضافة أداة جديدة ديناميكياً

### الطريقة 1: من لوحة التحكم (HTTP-based)

```yaml
# من الإعدادات:
name: my_custom_api
display_name: "My Custom API"
description: "Calls my internal API"
category: custom
schema:
  type: object
  properties:
    endpoint: { type: string }
    payload: { type: object }
  required: [endpoint]
handler:
  type: http
  config:
    method: POST
    base_url: https://my-api.internal
    auth:
      type: bearer
      token_secret: MY_API_TOKEN   # اسم المتغير في secrets
required_permissions: ["tools:execute:custom"]
timeout_ms: 15000
```

النظام يولّد `HttpTool` تلقائياً ويضيفه للـ Registry بدون إعادة تشغيل.

### الطريقة 2: عبر MCP

انظر `MCP.md`. كل أدوات الـ MCP server تُسجَّل تلقائياً في الـ Registry.

### الطريقة 3: Code Plugin (للمطورين)

```typescript
// src/tools/builtin/my-tool.ts
@registerTool('my_tool')
export class MyTool implements ITool {
  // ...
}
```

عند الإقلاع، الـ Registry يمسح `src/tools/builtin/` ويضمن كل الأدوات الموسومة.

---

## 9. تنفيذ Sandbox

أداة `code_execution` تنفّذ كود في sandbox معزول:

| اللغة | الـ Runtime | العزل |
|------|------------|------|
| JavaScript | `isolated-vm` | V8 isolates، limit memory + CPU |
| Python | subprocess + seccomp | filesystem restricted، no network |

كل تنفيذ له:
- timeout 10 ثوانٍ افتراضياً
- ذاكرة 256MB أقصى
- لا وصول لشبكة (default)
- مجلد مؤقت مخصص، يُحذف بعد التنفيذ

---

## 10. Audit & Tracing

كل استدعاء أداة:
- يُسجَّل في `tool_calls` (args، result، status، duration)
- يُنشئ span في الـ trace
- يُحسب تكلفة (لو استهلك API خارجي)
- يُدقّق (audit) لو كانت الأداة من فئة `sensitive` (filesystem, postgres_query, code_execution)

---

## 11. أمثلة استخدام من الوكلاء

```typescript
// Coding Agent يريد كتابة ملف
const result = await ctx.tools.execute('filesystem', {
  action: 'write',
  path: '/workspace/solution.py',
  content: code
}, ctx);

// Research Agent يبحث
const results = await ctx.tools.execute('web_search', {
  query: 'latest news about X',
  max_results: 5
}, ctx);

// Tool Agent ينفذ كود
const execResult = await ctx.tools.execute('code_execution', {
  language: 'python',
  code: 'print(2 + 2)'
}, ctx);
```

---

## 12. إعداد Railway المطلوب للأدوات

| الأداة | متغيرات البيئة |
|------|----------------|
| `web_search` | `TAVILY_API_KEY` أو `SERPAPI_KEY` أو `BRAVE_API_KEY` |
| `github` | `GITHUB_TOKEN` |
| `slack` | `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID` |
| `notion` | `NOTION_API_KEY` |
| `discord` | `DISCORD_BOT_TOKEN` |
| `email` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` |
| `browser` | (يحتاج Chromium مثبت — راجع قسم Browser Automation في ARCHITECTURE.md) |

كل هذه تُضاف من **إعدادات Railway** أو من **لوحة التحكم → Integrations**.

---

## 13. التوسع المستقبلي

- **Tool Composition**: أدوات مركّبة من أدوات أصغر
- **Tool Marketplace**: نشر/مشاركة أدوات بين المستخدمين
- **Tool Testing**: اختبار الأدوات قبل التفعيل
- **Tool Versioning**: كل أداة لها versions، يمكن الرجوع لإصدار أقدم
- **Cost-aware Tools**: اختيار الأداة الأرخص تلقائياً (مثلاً Tavily أرخص من SerpAPI)
