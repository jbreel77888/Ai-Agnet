# AGENTS — نظام الوكلاء

> وثيقة تصميم نظام الوكلاء (Agents): الأنواع، الـ Handoffs، الـ Sub-Agents، السياق المشترك.

---

## 1. الأدوار (Agent Roles)

| الوكيل | المسؤولية الرئيسية | متى يُستدعى |
|--------|---------------------|--------------|
| **Planner** | تحليل المهمة، تقسيمها إلى خطوات، اختيار الوكلاء المناسبين | بداية كل مهمة معقدة |
| **Research** | البحث وجمع المعلومات من الويب/الملفات/القاعدة | عند الحاجة لمعلومات خارجية |
| **Reasoning** | تحليل منطقي، استنتاج، حل المشكلات | عند الحاجة لقرارات معقدة |
| **Coding** | كتابة/تعديل/مراجعة الكود | عند الحاجة لإنتاج كود |
| **Execution** | تنفيذ الأوامر، إدارة العمليات | عند الحاجة لتنفيذ code/tools |
| **Tool** | اختيار وتنفيذ الأدوات | عند الحاجة لاستدعاء tool |
| **Memory** | تخزين واسترجاع المعلومات من الذاكرة طويلة المدى | عند الحاجة لسياق تاريخي |
| **Reflection** | مراجعة المخرجات، تقييم الجودة، اقتراح تحسينات | بعد إتمام خطوة كبيرة |
| **Summarizer** | ضغط السياق، تلخيص المحادثات الطويلة | عند اقتراب حد السياق |

---

## 2. الـ Base Agent Interface

```typescript
interface IAgent {
  readonly id: string;
  readonly slug: string;
  readonly type: AgentType;
  readonly config: AgentConfig;

  // دورة الحياة
  initialize(context: AgentContext): Promise<void>;
  shutdown(): Promise<void>;

  // التنفيذ الأساسي
  execute(input: AgentInput, ctx: AgentContext): AsyncIterable<AgentEvent>;
  cancel(): Promise<void>;

  // الـ Handoffs
  canHandle(input: AgentInput): number;          // درجة ملاءمة 0-1
  handoff(target: string, payload: HandoffPayload): Promise<void>;
  onHandoff(payload: HandoffPayload): Promise<void>;

  // Sub-Agents
  spawnSubAgent(type: AgentType, config?: Partial<AgentConfig>): Promise<IAgent>;
  listSubAgents(): IAgent[];

  // المراقبة
  getMetrics(): AgentMetrics;
  healthCheck(): Promise<HealthStatus>;
}
```

---

## 3. دورة التنفيذ (Execution Flow)

```
[User Request]
      │
      ▼
[Planner Agent] ─── ينشئ خطة: [{step, agent, inputs, deps}]
      │
      ▼
[Orchestrator] ─── يمر على الخطوات بالترتيب
      │
      ├──► [Research Agent] ───► (tool: web_search) ───► نتائج
      │
      ├──► [Reasoning Agent] ───► تحليل النتائج
      │
      ├──► [Coding Agent] ───► (tool: filesystem.write) ───► كود
      │
      ├──► [Execution Agent] ───► (tool: code_exec) ───► ناتج التشغيل
      │
      ├──► [Memory Agent] ───► (tool: memory.search) ───► سياق
      │
      ├──► [Reflection Agent] ───► تقييم + اقتراح تحسينات
      │           │
      │           └─(إن لزم)─► العودة لخطوة سابقة
      │
      └──► [Summarizer Agent] ───► (عند تجاوز السياق)
      │
      ▼
[Final Response] ───► يحفظ في messages + memory_long
```

---

## 4. Agent Handoffs

**المفهوم**: وكيل يسلّم التحكم لوكيل آخر مع تمرير السياق.

```typescript
interface HandoffPayload {
  from: string;                    // slug الوكيل المُسلِّم
  to: string;                      // slug الوكيل المُستقبِل
  reason: string;
  contextSnapshot: AgentContext;   // حالة كاملة
  partialOutput?: AgentOutput;
  instructions?: string;           // تعليمات إضافية
  requiredTools?: string[];        // أدوات يطلبها
  priority: 'low' | 'normal' | 'high';
}
```

**قواعد Handoff**:
1. كل وكيل يصرّح `handoff_targets` في إعداده (DB)
2. المنسق (Orchestrator) يتحقق من الصلاحيات
3. السياق يُمرَّر بالكامل + قائمة `instructions` الجديدة
4. الوكيل المُسلِّم يُعلّق ولا يُدمَّر (يمكن العودة إليه)
5. تُسجَّل كل Handoff في `tool_calls` للمراجعة

---

## 5. Sub-Agents (الوكلاء الفرعيون)

**متى**: عند الحاجة لمهمة معزولة لا تستحق وكيل رئيسي، أو لتنفيذ متوازي.

```typescript
// مثال: Research Agent يريد البحث في 3 مصادر بالتوازي
const [web, files, db] = await Promise.all([
  research.spawnSubAgent('research', { scope: 'web' }),
  research.spawnSubAgent('research', { scope: 'files' }),
  research.spawnSubAgent('research', { scope: 'database' }),
]);
```

**القيود**:
- `can_spawn_subagents: true` في إعداد الوكيل الأب
- `max_subagents` يحدد العدد الأقصى
- Sub-agents تشارك `sessionId` ولكن مع `parentMessageId`
- لا يمكن للـ Sub-agent إنشاء sub-agents خاصة به (عمق واحد فقط افتراضياً)
- Sub-agents تُدمَّر تلقائياً عند انتهاء الأب

---

## 6. Shared Context (السياق المشترك)

كل الوكلاء في نفس الجلسة يشاركون `AgentContext`:

```typescript
interface AgentContext {
  sessionId: string;
  userId: string;
  tenantId?: string;

  // السياق الراهن
  messages: Message[];
  variables: Map<string, unknown>;       // متغيرات الجلسة
  artifacts: Artifact[];

  // الذاكرة
  shortTermMemory: MemoryStore;          // Redis
  longTermMemoryRetriever: MemoryRetriever;

  // الأدوات المتاحة
  availableTools: ToolRegistry;
  mcpTools: MCPToolRegistry;

  // مرجع للنظام
  providers: ProviderManager;
  eventBus: EventBus;
  logger: Logger;
  tracer: Tracer;

  // حالة التنفيذ
  currentAgentId: string;
  parentAgentId?: string;
  handoffHistory: HandoffRecord[];
  stepNumber: number;
  budget: BudgetContext;                 // تكلفة + tokens متبقية
}
```

**التغييرات على الـ Context** تُمرَّر عبر `EventBus` وكل وكيل يرى نفس اللقطة.

---

## 7. Recursive Tasks (المهام المتكررة)

الحالة: وكيل يحتاج تفكيك مهمة لمهام فرعية متشابهة بنيوياً.

```typescript
// مثال: Research Agent يحلل 10 صفحات ويب
async function analyzePages(urls: string[], ctx: AgentContext) {
  const results: any[] = [];
  for (const url of urls) {
    const sub = await ctx.spawnSubAgent('research');
    const result = await sub.execute({ task: 'analyze_page', url }, ctx);
    results.push(result);
  }
  return results;
}
```

**حدود التكرار**:
- `maxRecursionDepth: 5` (إعداد عام)
- `maxTotalSteps: 100` لكل جلسة (إعادة ضبط يدوية)
- `maxTotalCost: 10` USD لكل مهمة (configurable)

---

## 8. تكوين الوكيل (Agent Configuration)

```typescript
interface AgentConfig {
  // LLM
  defaultModelId: string;
  fallbackModelIds: string[];
  temperature: number;
  maxTokens: number;
  topP: number;
  stopSequences?: string[];

  // السلوك
  systemPrompt: string;
  allowedTools: string[];                // tool IDs أو '*'
  deniedTools: string[];
  maxStepsPerRun: number;
  maxRetries: number;

  // Sub-Agents & Handoffs
  canSpawnSubagents: boolean;
  maxSubagents: number;
  handoffTargets: string[];              // agent slugs

  // الأمان
  requireApprovalForTools?: string[];    // أدوات تحتاج موافقة بشرية
  sandboxed: boolean;                    // تنفيذ معزول

  // الاعتمادية
  timeoutMs: number;
  retryStrategy: 'none' | 'exponential' | 'linear';
  fallbackAgentSlug?: string;            // وكيل بديل عند الفشل

  // المراقبة
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  traceEnabled: boolean;
}
```

---

## 9. أحداث الوكلاء (Agent Events)

كل وكيل يبث `AgentEvent` أثناء التنفيذ:

```typescript
type AgentEvent =
  | { type: 'started'; agentId: string; input: AgentInput }
  | { type: 'thinking'; content: string }
  | { type: 'message_chunk'; content: string }
  | { type: 'tool_call'; toolName: string; args: any }
  | { type: 'tool_result'; toolName: string; result: any; durationMs: number }
  | { type: 'handoff_request'; target: string; reason: string }
  | { type: 'subagent_spawned'; subAgentId: string; type: AgentType }
  | { type: 'error'; error: AgentError; recoverable: boolean }
  | { type: 'completed'; output: AgentOutput; tokensUsed: number; cost: number }
  | { type: 'cancelled'; reason: string };
```

هذه الأحداث تُستخدم لـ:
- بث Streaming للواجهة (SSE/WebSocket)
- تسجيل في `traces` و `audit_logs`
- حساب التكلفة
- الـ Reflection

---

## 10. اختيار الوكيل (Agent Selection)

عندما يكون هناك عدة وكلاء يمكنهم التعامل مع مهمة:

1. ** scoring**: كل وكيل يُرجع درجة 0-1 عبر `canHandle(input)`
2. **filter**: استبعاد المُعطَّلين أو متجاوزي الميزانية
3. **sort**: حسب (priority، درجة الملاءمة، التكلفة المتوقعة)
4. **select**: الأول، مع fallback للثاني عند الفشل

---

## 11. أمثلة على تدفقات شائعة

### 11.1 "اكتب لي تقريراً عن X"
```
User → Planner (يكتب خطة: research, outline, draft, review, finalize)
     → Research (web_search + memory)
     → Reasoning (تنظيم النقاط)
     → Coding (إنشاء ملف Markdown)
     → Reflection (مراجعة الجودة)
     → Summarizer (لو طالت)
     → Execution (تخزين التقرير)
     → User (رد نهائي)
```

### 11.2 "صحح هذا الـ bug"
```
User → Planner (يحدد: read_code, identify_bug, propose_fix, test)
     → Coding (filesystem.read)
     → Reasoning (تحليل السبب الجذري)
     → Coding (filesystem.write + التعديل)
     → Execution (code_exec: tests)
     → Reflection (نتائج الاختبارات)
     → User (ملخص + diff)
```

---

## 12. تكامل مع باقي الأنظمة

| النظام | التكامل |
|--------|---------|
| **Providers** | `providers.manager` لاستدعاء LLM |
| **Memory** | `memory.retrieval` لجلب سياق سابق |
| **Context** | `context.managers` لضغط/تلخيص عند الحاجة |
| **Tools** | `tools.registry` لاكتشاف وتنفيذ الأدوات |
| **MCP** | `mcp.client` للأدوات الخارجية |
| **Workflows** | يمكن لـ Workflow Step استدعاء وكيل |
| **Background** | المهام الطويلة تُنفَّذ في Queue |
| **Observability** | كل تنفيذ موثّق بـ trace |
| **Cost** | كل LLM call يُحتسب تلقائياً |
