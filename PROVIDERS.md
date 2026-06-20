# PROVIDERS — نظام المزودين

> وثيقة تصميم نظام المزودين (LLM Providers): الأنواع، الإدارة، Fallbacks، Capacities.

---

## 1. المزودون المدعومون

| المزود | النوع | Base URL الافتراضي | ملاحظات |
|--------|------|---------------------|---------|
| OpenAI | `openai` | `https://api.openai.com/v1` | GPT-4o, o1, GPT-4o-mini |
| Anthropic | `anthropic` | `https://api.anthropic.com/v1` | Claude 3.5 Sonnet/Opus/Haiku |
| Google Gemini | `gemini` | `https://generativelanguage.googleapis.com/v1beta` | Gemini 1.5/2.0 |
| Groq | `groq` | `https://api.groq.com/openai/v1` | Llama 3.3, Mixtral (سريع جداً) |
| Ollama | `ollama` | `http://localhost:11434/v1` | محلي، OpenAI-compatible |
| OpenRouter | `openrouter` | `https://openrouter.ai/api/v1` | بوابة لمئات النماذج |
| OpenAI-compatible | `openai_compatible` | متغير | أي خادم يتبع OpenAI API |
| Custom | `custom` | متغير | استراتيجية مخصصة في الكود |

---

## 2. الـ Base Provider Interface

```typescript
interface IProvider {
  readonly id: string;
  readonly slug: string;
  readonly type: ProviderType;
  readonly config: ProviderConfig;

  // دورة الحياة
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<ProviderHealth>;

  // العمليات
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): AsyncIterable<ChatChunk>;

  // النماذج
  listModels(): Promise<ModelInfo[]>;
  refreshModels(): Promise<void>;        // من API المزود

  // القدرات (Capabilities)
  getCapabilities(modelId: string): ModelCapabilities;
}
```

---

## 3. Capacities (القدرات)

كل نموذج يصرّح قدراته بوضوح:

```typescript
interface ModelCapabilities {
  supportsTools: boolean;        // function calling
  supportsVision: boolean;       // صور في الإدخال
  supportsStreaming: boolean;    // SSE
  supportsThinking: boolean;     // reasoning models (o1, Claude with thinking)
  supportsJsonMode: boolean;     // response_format: json
  supportsSystemPrompt: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
  supportedLanguages?: string[];
}
```

عند الاستدعاء، يتحقق `ProviderManager` أن الطلب متوافق مع قدرات النموذج؛ يُرفض الطلب إن لم يكن متوافقاً، أو يُحوَّل لنموذج بديل.

---

## 4. الـ Provider Manager

نقطة الدخول الوحيدة لكل الوكلاء:

```typescript
interface ProviderManager {
  chat(request: ChatRequest, opts?: ChatOptions): Promise<ChatResponse>;
  chatStream(request: ChatRequest, opts?: ChatOptions): AsyncIterable<ChatChunk>;

  // Fallback & Routing
  selectModel(preferredId: string, fallbackChain?: string[]): Model;
  registerProvider(provider: IProvider): void;

  // الإدارة
  getProvider(slug: string): IProvider;
  listProviders(): IProvider[];
  enableProvider(slug: string): Promise<void>;
  disableProvider(slug: string): Promise<void>;

  // المراقبة
  getMetrics(providerSlug?: string): ProviderMetrics;
}
```

**`ChatOptions`**:
```typescript
interface ChatOptions {
  timeoutMs?: number;
  maxRetries?: number;
  fallbackModelIds?: string[];       // إن لم يُمرّر، يستخدم الـ defaults من النموذج
  priority?: 'cost' | 'speed' | 'quality';
  costBudget?: number;               // USD أقصى
  traceId?: string;
  userId?: string;
  sessionId?: string;
}
```

---

## 5. Fallback Strategy

عند فشل طلب LLM، الـ Manager يتبع التالي:

```
1. retry على نفس النموذج (maxRetries=3, exponential backoff)
       ↓ إذا فشل
2. fallback للنموذج التالي في السلسلة
       ↓ إذا فشلت كل النماذج
3. fallback للـ Provider التالي (لو الـ primary provider معطّل)
       ↓ إذا فشل كل شيء
4. رمي ProviderUnavailableError (يُلتقط من الـ Orchestrator)
```

**أسباب الـ Fallback**:
- HTTP 429 (rate limit) — تحويل فوري لمزود آخر
- HTTP 5xx — retry ثم fallback
- Timeout — retry بنفس النموذج ثم fallback
- Invalid Request (لا fallback — خطأ برمجي)
- Context window exceeded — fallback لنموذج بنافذة أكبر

---

## 6. Circuit Breaker

كل مزود له Circuit Breaker مستقل:

| الحالة | الشرط | السلوك |
|--------|------|--------|
| CLOSED (طبيعي) | < 5 فشل في آخر 10 ثوانٍ | كل الطلبات تمر |
| OPEN (مفتوح) | ≥ 5 فشل متتالٍ | كل الطلبات تُحوَّل لـ fallback فوراً |
| HALF_OPEN | بعد 30 ثانية من OPEN | يُسمح بطلب اختبار واحد |

---

## 7. التكاليف (Cost)

كل استدعاء يحسب تكلفته فوراً:

```typescript
function calculateCost(model: Model, inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1000) * model.inputPricePer1k;
  const outputCost = (outputTokens / 1000) * model.outputPricePer1k;
  return inputCost + outputCost;
}
```

يُسجَّل في `cost_records` ويُحدَّث `cost_budgets.spent_usd`. عند تجاوز الحد:
- `warn`: تسجيل + إشعار
- `block`: رفض الطلب
- `notify`: إرسال webhook/email

---

## 8. استراتيجيات المزودين (Provider Strategies)

كل نوع مزود له `Strategy` منفصلة في `src/providers/strategies/`:

| الملف | المزود |
|------|--------|
| `openai.strategy.ts` | OpenAI + OpenAI-compatible |
| `anthropic.strategy.ts` | Anthropic |
| `gemini.strategy.ts` | Google Gemini |
| `groq.strategy.ts` | Groq |
| `ollama.strategy.ts` | Ollama |
| `openrouter.strategy.ts` | OpenRouter |
| `custom.strategy.ts` | Custom (plugin) |

كل Strategy تنفّذ `IProviderStrategy`:
```typescript
interface IProviderStrategy {
  normalizeRequest(request: ChatRequest, model: Model): any;
  parseResponse(raw: any): ChatResponse;
  parseStreamChunk(raw: any): ChatChunk | null;
  extractTokens(raw: any): { input: number; output: number };
  extractError(raw: any): ProviderError;
}
```

هذا يفصل تفاصيل كل API عن المنطق العام.

---

## 9. Streaming Protocol

كل المزودين يدعمون SSE-style streaming عبر `AsyncIterable<ChatChunk>`:

```typescript
interface ChatChunk {
  delta?: {
    content?: string;
    toolCalls?: ToolCallDelta[];
    thinking?: string;            // للنماذج التي تُظهر تفكيرها
  };
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  usage?: { inputTokens: number; outputTokens: number };
  model?: string;
}
```

الـ Provider Manager يوحّد الـ streaming حتى لو كانت الـ APIs مختلفة (Anthropic vs OpenAI vs Gemini).

---

## 10. إدارة الـ API Keys

- تُخزَّن مشفّرة AES-256-GCM في `providers.api_key_encrypted`
- تُحمَّل للذاكرة فقط عند الحاجة
- تُستبدل دورياً (remind admin كل 90 يوماً)
- تُسجَّل كل عمليات القراءة في `audit_logs`

---

## 11. مزامنة النماذج

```typescript
// كل 24 ساعة (أو يدوياً من لوحة التحكم):
await provider.refreshModels();
// يستدعي API المزود (مثل /v1/models) ويسجّل أي:
// - نماذج جديدة → status='active' أول مرة
// - نماذج لم تعد متاحة → status='deprecated'
// - تحديثات أسعار (لو يوفرها الـ API)
```

---

## 12. إعدادات Railway

متغيرات بيئة مطلوبة على Railway:
```
# يمكن تركها فارغة إذا ستُضاف من لوحة التحكم
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=

# للتشفير (مهم جداً — لا تُغيّر بعد الإعداد)
ENCRYPTION_KEY=base64-encoded-32-bytes
```

**إجراء يدوي مطلوب**: توليد `ENCRYPTION_KEY` عبر `openssl rand -base64 32` وحفظه بأمان.

---

## 13. أمثلة إعداد المزودين من لوحة التحكم

### مثال: OpenAI
```yaml
name: OpenAI
slug: openai
type: openai
base_url: https://api.openai.com/v1
api_key: sk-...
status: active
timeout_ms: 30000
max_retries: 3
headers: {}
```

### مثال: Ollama محلي
```yaml
name: Ollama Local
slug: ollama
type: ollama
base_url: http://localhost:11434/v1
api_key: ollama          # أي قيمة — Ollama لا يتحقق
status: active
```

### مثال: Custom (DeepSeek عبر OpenAI-compatible)
```yaml
name: DeepSeek
slug: deepseek
type: openai_compatible
base_url: https://api.deepseek.com/v1
api_key: sk-...
status: active
```
