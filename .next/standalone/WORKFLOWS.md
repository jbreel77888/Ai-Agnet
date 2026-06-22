# WORKFLOWS — محرك تدفقات العمل

> وثيقة تصميم محرك Workflows: العقد، الشروط، التوازي، إعادة المحاولة، Timeouts، حفظ الحالة.

---

## 1. نظرة عامة

Workflow = رسم بياني موجه (DAG) من **nodes** متصلة بـ **edges**. كل node تمثّل خطوة (استدعاء وكيل، أداة، شرط، توازي، إلخ).

```
       ┌─────────┐
       │  Start  │
       └────┬────┘
            ▼
    ┌──────────────┐
    │  Planner     │ (Agent Node)
    └──────┬───────┘
           ▼
    ┌──────────────┐     false
    │  Has Code?   │──────────►┌──────────┐
    └──────┬───────┘            │ Notify   │
       true│                    └────┬─────┘
           ▼                         │
    ┌──────────────┐                 │
    │  Code Gen    │ (Parallel)      │
    │  + Tests     │                 │
    └──────┬───────┘                 │
           ▼                         │
    ┌──────────────┐                 │
    │  Review      │                 │
    └──────┬───────┘                 │
           ▼                         │
    ┌──────────────┐◄────────────────┘
    │   End        │
    └──────────────┘
```

---

## 2. أنواع العقد (Node Types)

| النوع | الوصف | الحقول |
|------|------|--------|
| `start` | نقطة البداية (واحدة لكل workflow) | `input_schema` |
| `end` | نقطة النهاية (واحدة أو أكثر) | `output_mapping` |
| `agent` | استدعاء وكيل | `agentId`, `input`, `timeoutMs` |
| `tool` | استدعاء أداة | `toolName`, `args`, `timeoutMs` |
| `condition` | تفرع شرطي | `expression`, `branches: {true, false}` |
| `parallel` | تنفيذ متوازي | `branches: Node[]`, `joinStrategy` |
| `loop` | تكرار | `iterator`, `body`, `maxIterations` |
| `delay` | تأخير زمني | `durationMs` |
| `code` | كود JavaScript مخصص | `script`, `timeoutMs` |
| `handoff` | تحويل لوكيل آخر | `targetAgentId`, `payload` |
| `webhook` | انتظار webhook خارجي | `eventId`, `timeoutMs` |
| `human_approval` | موافقة بشرية | `approvers`, `timeoutMs` |
| `sub_workflow` | استدعاء workflow آخر | `workflowId`, `input` |

---

## 3. تعريف الـ Workflow (Workflow Definition)

```typescript
interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  description: string;

  // العقد
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];

  // المخرجات المتوقعة
  outputSchema?: JSONSchema;

  // الإعدادات العامة
  timeoutMs: number;                  // للـ workflow كله
  maxRetries: number;
  retryStrategy: 'none' | 'exponential' | 'linear';

  // المشغّل
  trigger:
    | { type: 'manual' }
    | { type: 'webhook'; path: string; method: 'GET' | 'POST' }
    | { type: 'schedule'; cron: string }
    | { type: 'event'; eventName: string };

  // المتغيرات الأولية
  initialVariables?: Record<string, unknown>;
}

interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: NodeConfig;                 // يختلف حسب النوع
  position: { x: number; y: number }; // للعرض البصري
}

interface WorkflowEdge {
  id: string;
  from: string;                       // node id
  to: string;                         // node id
  condition?: string;                 // تعبير للـ condition nodes
  label?: string;
}
```

---

## 4. حالة التنفيذ (Run State)

```typescript
interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  input: unknown;
  output?: unknown;
  context: WorkflowContext;           // الحالة المشتركة
  currentStepId?: string;
  error?: { code: string; message: string; nodeId?: string };
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
}

interface WorkflowContext {
  variables: Map<string, unknown>;    // متغيرات قابلة للقراءة/الكتابة
  stepResults: Map<string, NodeResult>;   // node_id → output
  artifacts: Artifact[];
  traceId: string;
  parentRunId?: string;               // للـ sub-workflows
}
```

---

## 5. الـ Executor

```typescript
class WorkflowExecutor {
  async start(workflowId: string, input: unknown, opts?: StartOpts): Promise<WorkflowRun>;
  async resume(runId: string): Promise<WorkflowRun>;          // بعد pause أو human_approval
  async cancel(runId: string, reason?: string): Promise<void>;
  async retry(runId: string, fromNodeId?: string): Promise<WorkflowRun>;

  // الحالة
  getStatus(runId: string): Promise<WorkflowRun>;
  getStepResults(runId: string): Promise<Map<string, NodeResult>>;
  getContext(runId: string): Promise<WorkflowContext>;

  // الأحداث
  on(event: WorkflowEvent, cb: (e: any) => void): void;
}
```

### دورة التنفيذ

```
[start()] → ينشئ WorkflowRun بحالة 'pending'
   ↓
يُمرّر إلى BullMQ queue 'workflows'
   ↓
Worker يلتقط:
   1. يحمّل WorkflowDefinition
   2. يبني graph في الذاكرة
   3. يبدأ من 'start' node
   4. لكل node:
      a. يتحقق من preconditions (edges سابقة منفّذة)
      b. ينفّذ الـ node handler
      c. يحفظ النتيجة في context.stepResults
      d. يحدد الـ next nodes (حسب type و edges)
      e. ينشر event 'step.completed'
   5. عند الوصول لـ 'end' node:
      - يحفظ الـ output
      - يحدّث status إلى 'completed'
      - ينشر event 'workflow.completed'
   6. عند الخطأ:
      - يحفظ الـ error
      - يحاول retry (لو maxRetries > 0)
      - يحدّث status إلى 'failed' لو فشلت كل المحاولات
```

---

## 6. الشروط (Conditions)

```typescript
// node: condition
config: {
  expression: "context.variables.hasCode === true"
}

// أو متقدم:
config: {
  expression: `
    const codeLength = context.stepResults.code_gen.output.length;
    const hasErrors = context.stepResults.tests.output.errors.length > 0;
    return codeLength > 100 && !hasErrors;
  `
}
```

**الأمان**: التعبيرات تُنفَّذ في sandbox (`isolated-vm`) مع timeout 1 ثانية، وصلحيات قراءة فقط على `context`.

---

## 7. التوازي (Parallel)

```typescript
// node: parallel
config: {
  branches: [
    { nodeId: 'gen_frontend' },
    { nodeId: 'gen_backend' },
    { nodeId: 'gen_tests' }
  ],
  joinStrategy: 'all' | 'any' | 'race' | 'n_of_m'
  // 'all': انتظار كل الفروع
  // 'any': انتظار أول فرع ينجح
  // 'race': أول فرع يكتسب (نجاح أو فشل)
  // 'n_of_m': انتظار n من m فروع
  n: 2  // للـ n_of_m
}
```

كل فرع يُنفَّذ في Task مستقلة في BullMQ. النتائج تُجمَّع في `context.stepResults[parallelNodeId].branches`.

---

## 8. إعادة المحاولة (Retry)

### على مستوى Node

```typescript
// node config
{
  retries: {
    maxAttempts: 3,
    strategy: 'exponential',
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    retryOn: ['timeout', 'provider_error', 'rate_limit'],
    // أو function للحكم المخصص
    shouldRetry: (error, attempt) => error.code !== 'INVALID_ARGS'
  }
}
```

### على مستوى Workflow

عند فشل workflow كامل، يمكن:
- `retry from failed node` — يعيد فقط الـ node الفاشلة (وما بعدها)
- `retry from start` — يبدأ من جديد
- `retry with different inputs` — تعديل الـ input

---

## 9. Timeouts

| المستوى | الافتراضي | المخصص |
|---------|-----------|--------|
| Node | 30s | حسب نوع الـ node |
| Workflow | 1h | حسب الـ workflow |
| Human Approval | 24h | configurable |
| Webhook Wait | 5min | configurable |

عند الـ timeout:
- الـ node يُلغى (cancel signal)
- الـ context يُحفظ (يمكن الاستئناف)
- الـ workflow يدخل حالة 'failed' (أو 'paused' لو أراد المستخدم التدخل)

---

## 10. حفظ الحالة (Persistence)

كل تغيير في حالة الـ workflow يُكتب فوراً إلى PostgreSQL:

| الحدث | الجدول |
|------|--------|
| بدء run | `workflow_runs` (insert) |
| بدء node | `workflow_step_runs` (insert, status='running') |
| إكمال node | `workflow_step_runs` (update status='completed', output) |
| فشل node | `workflow_step_runs` (update status='failed', error) |
| تغيير متغير | `workflow_runs.context` (jsonb update) |
| إكمال run | `workflow_runs` (update status, output, completed_at) |

هذا يضمن:
- استمرارية بعد إعادة تشغيل النظام (Workers يلتقطون runs غير مكتملة)
- إمكانية الفحص والمراجعة (audit trail كامل)
- إمكانية الاستئناف اليدوي

---

## 11. السمات المتقدمة

### 11.1 Sub-Workflows

```typescript
// node: sub_workflow
config: {
  workflowId: 'code-review-pipeline',
  input: { code: '${context.stepResults.gen_code.output}' },
  waitForCompletion: true,
  inheritContext: false      // عزل افتراضي
}
```

الـ sub-workflow له `parentRunId`، ويمكنه الوصول لـ context الأب فقط لو `inheritContext: true`.

### 11.2 Webhook Trigger

```yaml
trigger:
  type: webhook
  path: /webhooks/my-workflow
  method: POST
```

URL الناتج: `https://your-domain.com/api/workflows/webhook/my-workflow`

كل استدعاء يبدأ run جديد. الـ payload يصبح الـ input.

### 11.3 Schedule Trigger (Cron)

```yaml
trigger:
  type: schedule
  cron: "0 9 * * 1-5"   # كل يوم عمل 9 صباحاً
```

يستخدم BullMQ repeating jobs. يمكن تعليق/استئناف الجدولة من لوحة التحكم.

### 11.4 Event Trigger

```yaml
trigger:
  type: event
  eventName: 'memory.fact.stored'
```

عند إصدار هذا الـ event من أي مكان في النظام، يبدأ الـ workflow.

---

## 12. أمثلة workflows

### مثال 1: Research → Report Pipeline

```yaml
name: research_report
nodes:
  - id: start
    type: start
  
  - id: plan
    type: agent
    config: { agentId: planner, input: '${input.topic}' }
  
  - id: research
    type: agent
    config: { agentId: researcher, input: '${context.stepResults.plan.output}' }
  
  - id: check_quality
    type: condition
    config: { expression: 'context.stepResults.research.output.qualityScore > 0.7' }
  
  - id: reflect
    type: agent
    config: { agentId: reflection, input: '${context.stepResults.research.output}' }
    retries: { maxAttempts: 2 }
  
  - id: draft
    type: agent
    config: { agentId: coder, input: '${context.stepResults.reflect.output}' }
  
  - id: end
    type: end

edges:
  - { from: start, to: plan }
  - { from: plan, to: research }
  - { from: research, to: check_quality }
  - { from: check_quality, to: reflect, condition: 'true' }
  - { from: check_quality, to: draft, condition: 'false' }
  - { from: reflect, to: draft }
  - { from: draft, to: end }
```

### مثال 2: Parallel Code Generation

```yaml
name: parallel_code_gen
nodes:
  - id: start
    type: start
  
  - id: spec
    type: agent
    config: { agentId: planner, input: '${input.requirement}' }
  
  - id: parallel_gen
    type: parallel
    config:
      branches:
        - nodeId: gen_frontend
        - nodeId: gen_backend
        - nodeId: gen_tests
      joinStrategy: all
  
  - id: gen_frontend
    type: agent
    config: { agentId: coder, input: { type: 'frontend', spec: '${context.stepResults.spec.output}' } }
  
  - id: gen_backend
    type: agent
    config: { agentId: coder, input: { type: 'backend', spec: '${context.stepResults.spec.output}' } }
  
  - id: gen_tests
    type: agent
    config: { agentId: coder, input: { type: 'tests', spec: '${context.stepResults.spec.output}' } }
  
  - id: integrate
    type: agent
    config: { agentId: coder, input: '${context.stepResults.parallel_gen.branches}' }
  
  - id: end
    type: end
```

---

## 13. الـ Visual Editor (مستقبلاً)

في المرحلة 6 (Admin UI)، سيتم بناء محرر مرئي للـ workflows باستخدام React Flow:
- سحب وإفلات nodes
- ربط بالماوس
- معاينة الـ definition JSON
- اختبار (dry run)
- نشر كنسخة جديدة

---

## 14. التكامل مع الأنظمة الأخرى

| النظام | التكامل |
|--------|---------|
| **Agents** | node من نوع `agent` يستدعي أي وكيل |
| **Tools** | node من نوع `tool` ينفّذ أي أداة |
| **Background** | كل workflow run يُنفَّذ في BullMQ |
| **Sessions** | يمكن ربط workflow run بـ session لمتابعة المحادثة |
| **Memory** | workflow يمكنه استدعاء `memory_search` tool |
| **Observability** | كل step يُسجَّل كـ span في الـ trace |
