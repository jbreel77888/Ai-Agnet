# MEMORY — نظام الذاكرة

> وثيقة تصميم نظام الذاكرة: قصيرة المدى (Redis)، طويلة المدى (PostgreSQL + pgvector)، الضغط، الاسترجاع الدلالي.

---

## 1. نظرة عامة

```
┌──────────────────────────────────────────────────────────┐
│                    Agent Context                          │
│  ┌─────────────────┐    ┌──────────────────────────────┐│
│  │  Short-Term     │    │       Long-Term               ││
│  │  (Redis)        │    │  (PostgreSQL + pgvector)      ││
│  │                 │    │                               ││
│  │  - Last N msgs  │    │  - Facts                      ││
│  │  - Session vars │    │  - Entities                   ││
│  │  - TTL: 24h     │    │  - Summaries                  ││
│  │                 │    │  - Preferences                ││
│  └────────┬────────┘    └────────────┬──────────────────┘│
│           │                            │                  │
│           └──────────┬─────────────────┘                  │
│                      ▼                                    │
│           ┌─────────────────────┐                         │
│           │   Context Engine    │                         │
│           │  - Compression      │                         │
│           │  - Retrieval        │                         │
│           │  - Summarization    │                         │
│           └─────────────────────┘                         │
└──────────────────────────────────────────────────────────┘
```

---

## 2. الذاكرة قصيرة المدى (Short-Term)

### المخزن: Redis

| النوع | Key Pattern | TTL |
|------|------------|-----|
| رسائل الجلسة | `session:{id}:messages` (List) | 24 ساعة |
| متغيرات الجلسة | `session:{id}:vars` (Hash) | 24 ساعة |
| حالة الوكيل | `session:{id}:agent:{agentId}:state` | 24 ساعة |
| Cache لـ LLM response | `llm:cache:{hash}` | 1 ساعة |
| Rate limit counters | `rl:{user}:{tool}` | 1 دقيقة |

### الـ Interface

```typescript
interface ShortTermMemory {
  addMessage(sessionId: string, msg: Message): Promise<void>;
  getMessages(sessionId: string, opts?: { limit?: number; since?: Date }): Promise<Message[]>;
  clearMessages(sessionId: string): Promise<void>;

  setVar(sessionId: string, key: string, value: unknown): Promise<void>;
  getVar<T>(sessionId: string, key: string): Promise<T | undefined>;
  deleteVar(sessionId: string, key: string): Promise<void>;

  setAgentState(sessionId: string, agentId: string, state: unknown): Promise<void>;
  getAgentState(sessionId: string, agentId: string): Promise<unknown>;

  // للمزامنة مع PostgreSQL (استمرارية بعد إعادة التشغيل)
  persistSession(sessionId: string): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
}
```

### المزامنة مع PostgreSQL

- كل رسالة في Redis تُكتب **أيضاً** في `messages` table (async)
- عند إعادة تشغيل النظام، Redis يُعاد ملؤه من PostgreSQL آخر 50 رسالة لكل جلسة نشطة
- هذا يضمن عدم ضياع البيانات + سرعة Redis

---

## 3. الذاكرة طويلة المدى (Long-Term)

### المخزن: PostgreSQL + pgvector

أنواع السجلات (راجع `DATABASE.md` قسم 3.6):

| الجدول | المحتوى |
|--------|--------|
| `memory_long` | حقائق عامة، تفضيلات، أحداث |
| `memory_entities` | كيانات مستخرجة (أشخاص، مشاريع، مفاهيم) |
| `memory_summaries` | ملخصات الجلسات والمراحل |
| `memory_short` | نسخة احتياطية للذاكرة قصيرة المدى |

### الـ Interface

```typescript
interface LongTermMemory {
  // الكتابة
  store(input: StoreMemoryInput): Promise<MemoryRecord>;
  storeFact(fact: string, type: FactType, opts?: StoreOpts): Promise<MemoryRecord>;
  storeEntity(entity: EntityInput): Promise<EntityRecord>;
  storeSummary(summary: SummaryInput): Promise<SummaryRecord>;

  // الاسترجاع الدلالي
  search(query: MemoryQuery): Promise<MemorySearchResult[]>;
  searchByEntity(entityType: string, value: string): Promise<MemoryRecord[]>;

  // الإدارة
  update(id: string, patch: Partial<MemoryRecord>): Promise<void>;
  delete(id: string): Promise<void>;
  forget(filter: MemoryFilter): Promise<number>;     // حذف جماعي
  decay(): Promise<void>;                             // تقليل أهمية الـ stale

  // الإحصائيات
  stats(userId?: string): Promise<MemoryStats>;
}

interface MemoryQuery {
  text: string;                       // نص الاستعلام (سيُحوَّل لـ embedding)
  userId?: string;
  agentId?: string;
  sessionId?: string;
  factTypes?: FactType[];
  topK?: number;                      // default 5
  minScore?: number;                  // 0-1, default 0.7
  timeRange?: { from?: Date; to?: Date };
}
```

---

## 4. Memory Compression (ضغط الذاكرة)

عند اقتراب الجلسة من حد السياق:

```
[100 messages في الجلسة]
        │
        ▼
[Context Engine يكتشف: tokens > 80% من الحد]
        │
        ▼
[Compression Strategy]
        ├──► الرسائل 1-30 → Summary 1
        ├──► الرسائل 31-60 → Summary 2
        └──► الرسائل 61-100 → تبقى كما هي
        │
        ▼
[السياق الجديد: Summary1 + Summary2 + آخر 40 رسالة]
[tokens انخفض من 120k إلى 35k]
```

### استراتيجيات الضغط

| الاستراتيجية | متى تُستخدم | المخرجات |
|--------------|-------------|----------|
| **Rolling Summary** | محادثة عادية طويلة | ملخص متراكم + آخر N رسائل |
| **Semantic Grouping** | محادثة بمواضيع متعددة | تلخيص كل مجموعة موضوعية |
| **Extractive** | محادثة تقنية (احتفاظ بالتفاصيل) | اختيار أهم الجمل فقط |
| **Hierarchical** | جلسات يومية | ملخص يومي + ملخص أسبوعي |

الاستراتيجية تُختار تلقائياً حسب نوع المحتوى، أو يدوياً من إعدادات الوكيل.

---

## 5. Semantic Retrieval (الاسترجاع الدلالي)

```typescript
// عند بدء كل استدعاء LLM:
async function enrichContext(ctx: AgentContext, userMessage: string) {
  // 1. توليد embedding للرسالة
  const embedding = await embeddings.embed(userMessage);

  // 2. بحث في الذاكرة طويلة المدى
  const facts = await longTermMemory.search({
    text: userMessage,
    userId: ctx.userId,
    topK: 5,
    minScore: 0.75
  });

  // 3. بحث في ملخصات الجلسات السابقة
  const pastSummaries = await longTermMemory.searchSummaries({
    text: userMessage,
    userId: ctx.userId,
    topK: 3
  });

  // 4. بحث في الكيانات
  const entities = await entityExtractor.extract(userMessage);
  const entityMemories = await Promise.all(
    entities.map(e => longTermMemory.searchByEntity(e.type, e.value))
  );

  // 5. حقن النتائج في system prompt
  return buildEnrichedSystemPrompt({ facts, pastSummaries, entityMemories });
}
```

---

## 6. Automatic Summarization

### متى يُلخّص النظام تلقائياً؟

| الحدث | الإجراء |
|------|--------|
| انتهاء جلسة | تلخيص كامل + تخزين في `memory_summaries` |
| تجاوز 80% من السياق | ضغط القسم الأقدم |
| كل 50 رسالة | إنشاء ملخص تراكمي |
| اكتمال مهمة فرعية | تلخيص نتائج المهمة |
| طلب وكيل Reflection | تلخيص لمراجعة الجودة |

### ملخص الجلسة — الحقول

```typescript
interface SessionSummary {
  sessionId: string;
  agentId: string;
  summary: string;              // 3-10 جمل
  keyDecisions: string[];
  entitiesMentioned: EntityRef[];
  factsLearned: string[];
  tokensSaved: number;
  coveredMessageIds: string[];
}
```

---

## 7. استخراج الحقائق والكيانات

### Fact Extraction

```typescript
// عند كل رسالة من assistant:
async function extractFacts(message: string, ctx: AgentContext) {
  const prompt = `Extract durable facts from this conversation. 
  Return JSON: [{fact, type, confidence}]`;
  const facts = await llm.complete(prompt + message);

  for (const fact of facts) {
    if (fact.confidence > 0.7) {
      await longTermMemory.storeFact(fact.fact, fact.type, {
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        importance: fact.confidence
      });
    }
  }
}
```

### Entity Extraction

استخراج: أشخاص، شركات، مشاريع، تقنيات، تواريخ، أماكن.

```typescript
// مثال مخرجات:
[
  { type: 'person', value: 'John Doe', canonical: 'John Doe', aliases: ['John'] },
  { type: 'project', value: 'Atlas v2', canonical: 'Atlas v2', aliases: ['atlas2'] }
]
```

كل كيان يُخزَّن في `memory_entities` مع embedding خاص به، مما يتيح:
- البحث عن كل الحقائق المرتبطة بكيان معين
- حل الإحالات (John → John Doe)
- بناء graph معرفي مستقبلاً

---

## 8. Memory Decay (الاهتلاك)

الذكريات غير المستخدمة تفقد أهميتها بمرور الوقت:

```typescript
// كل يوم (cron job):
async function decay() {
  await db.execute(sql`
    UPDATE memory_long
    SET importance = importance * 0.95
    WHERE last_accessed_at < NOW() - INTERVAL '7 days'
      AND importance > 0.1
  `);

  // حذف الذكريات منخفضة الأهمية جداً
  await db.execute(sql`
    DELETE FROM memory_long
    WHERE importance < 0.05
      AND last_accessed_at < NOW() - INTERVAL '90 days'
  `);
}
```

عند الوصول لذاكرة، `importance` يرتفع +1 (بحد أقصى 1.0) و`last_accessed_at` يُحدَّث.

---

## 9. نسيان الذاكرة (Forgetting)

### نسيان صريح
- المستخدم يقول "انسَ أنني قلت X"
- أمر من لوحة التحكم

### نسيان تلقائي
- تجاوز الحد الأقصى للذاكرة لكل مستخدم (default: 10000 سجل)
- حذف الحساب → حذف كل الذاكرة

### النسيان الانتقائي
- "انسَ كل ما يخص {مشروع معين}" — يحذف كل السجلات الموسومة بالكيان

---

## 10. الـ Embeddings

| المزود | النموذج | الأبعاد | السعر / 1M token |
|--------|--------|---------|------------------|
| OpenAI | text-embedding-3-small | 1536 | $0.02 |
| OpenAI | text-embedding-3-large | 3072 | $0.13 |
| Cohere | embed-english-v3 | 1024 | $0.10 |
| Ollama | nomic-embed-text | 768 | مجاني (محلي) |

**الإعداد**: من لوحة التحكم → Settings → Embeddings. النظام يختار النموذج المفضّل ويطبّقه على كل الـ pgvector operations.

**مهم**: تغيير الـ embedding model يتطلب إعادة توليد كل الـ embeddings (job في الخلفية).

---

## 11. الفهارس والأداء

```sql
-- فهرس ivfflat للبحث الدلالي السريع
CREATE INDEX ON memory_long USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- فهارس عادية
CREATE INDEX ON memory_long (user_id, last_accessed_at);
CREATE INDEX ON memory_entities (entity_type, canonical);
```

عند تجاوز 100k سجل، نزيد `lists` إلى 200-500.

---

## 12. الخصوصية والامتثال

- **GDPR**: زر "تصدير ذاكرتي" + "نسياني" في لوحة التحكم
- **تعدد المستأجرين**: كل سجل يربط بـ `tenantId` (مستقبلاً)
- **التشفير at-rest**: PostgreSQL يشفّر الأقراص (Railway يفعّل هذا افتراضياً)
- **حذف آمن**: حذف الذاكرة يستخدم `DELETE` (ليس soft delete)

---

## 13. التكامل مع Context Engine

الذاكرة ليست معزولة — تُدمج في السياق عبر `context/managers/`:

```
[User Message]
      │
      ▼
[Context Manager]
      ├──► ShortTerm.getMessages() → آخر N رسالة
      ├──► LongTerm.search() → حقائق ذات صلة
      ├──► LongTerm.searchSummaries() → ملخصات سابقة
      ├──► Entity lookup → معلومات الكيانات المذكورة
      └──► Compress (if needed) → ضغط
      │
      ▼
[System Prompt للـ LLM]
```

راجع `AGENTS.md` قسم 6 (Shared Context).
