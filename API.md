# API — واجهة REST API

> وثيقة تصميم الـ REST API الكاملة: المسارات، المصادقة، الـ Rate Limits، الـ Streaming.

---

## 1. الإصدار والمسار الأساسي

```
Base URL: https://your-domain.com/api
Version:  v1 (default)
```

كل المسارات تُسبق بـ `/api`. لا حاجة لـ `/v1` في الـ URL (يُحدد بالـ header `API-Version: 1`).

---

## 2. المصادقة

### 2.1 JWT Bearer Tokens

```http
Authorization: Bearer <access_token>
```

- **Access Token**: صلاحية 15 دقيقة
- **Refresh Token**: صلاحية 7 أيام (rotating — كل استخدام يُولّد واحداً جديداً)

### 2.2 الـ Endpoints

| Method | Path | الوصف |
|--------|------|-------|
| `POST` | `/api/auth/register` | تسجيل مستخدم جديد |
| `POST` | `/api/auth/login` | تسجيل الدخول |
| `POST` | `/api/auth/refresh` | تجديد access token |
| `POST` | `/api/auth/logout` | تسجيل الخروج (revoke refresh) |
| `GET`  | `/api/auth/me` | بيانات المستخدم الحالي |
| `PATCH`| `/api/auth/me` | تحديث البيانات |
| `POST` | `/api/auth/change-password` | تغيير كلمة المرور |

### 2.3 RBAC

كل endpoint يصرّح الأدوار المسموحة:

```typescript
@RequireRoles('admin', 'operator')
@RequirePermission('providers', 'write')
async createProvider() { ... }
```

الـ roles:
- `admin`: كل شيء
- `operator`: إدارة الوكلاء/الأدوات/الجلسات + مشاهدة المستخدمين
- `user`: استخدام المنصة فقط (إنشاء جلسات، رسائل)

---

## 3. Rate Limits

| النوع | الحد | النافذة |
|------|------|--------|
| anonymous | 10 requests | per minute per IP |
| authenticated | 100 requests | per minute per user |
| LLM endpoints | 30 requests | per minute per user |
| Streaming endpoints | 10 concurrent | per user |

التجاوز يُرجع `429 Too Many Requests` مع `Retry-After` header.

---

## 4. التنسيقات

### 4.1 Request

```http
POST /api/sessions
Content-Type: application/json
Authorization: Bearer <token>

{ "agentId": "...", "title": "..." }
```

### 4.2 Response — Success

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO-8601",
    "durationMs": 123
  }
}
```

### 4.3 Response — Error

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [
      { "field": "email", "message": "Invalid email format" }
    ]
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO-8601"
  }
}
```

### 4.4 HTTP Status Codes

| Code | المعنى |
|------|--------|
| 200 | نجاح |
| 201 | تم الإنشاء |
| 204 | نجاح بدون محتوى |
| 400 | خطأ في الـ request (validation) |
| 401 | غير مصادق |
| 403 | ممنوع (صلاحيات) |
| 404 | غير موجود |
| 409 | تعارض |
| 422 | خطأ منطقي |
| 429 | تجاوز rate limit |
| 500 | خطأ داخلي |

---

## 5. الـ Streaming

للـ endpoints التي تُرجع نتائج من LLM بشكل متدفق:

```http
POST /api/sessions/:id/messages
Accept: text/event-stream

data: {"type":"thinking","content":"Analyzing..."}

data: {"type":"message_chunk","content":"Hello"}

data: {"type":"tool_call","tool":"web_search","args":{"query":"..."}}

data: {"type":"tool_result","tool":"web_search","result":[...]}

data: {"type":"completed","messageId":"...","tokensUsed":123}

[done]
```

الـ server يحفظ الاتصال مفتوحاً حتى:
- اكتمال الرد
- إغلاق العميل للاتصال
- timeout (30 دقيقة أقصى)

---

## 6. الـ Endpoints الكاملة

### 6.1 Providers

| Method | Path | Roles |
|--------|------|-------|
| `GET`    | `/api/providers` | admin, operator |
| `POST`   | `/api/providers` | admin |
| `GET`    | `/api/providers/:id` | admin, operator |
| `PATCH`  | `/api/providers/:id` | admin |
| `DELETE` | `/api/providers/:id` | admin |
| `POST`   | `/api/providers/:id/test` | admin |
| `POST`   | `/api/providers/:id/refresh-models` | admin |
| `GET`    | `/api/providers/:id/models` | admin, operator |
| `POST`   | `/api/providers/:id/models` | admin |
| `PATCH`  | `/api/providers/:id/models/:modelId` | admin |
| `DELETE` | `/api/providers/:id/models/:modelId` | admin |

### 6.2 Agents

| Method | Path | Roles |
|--------|------|-------|
| `GET`    | `/api/agents` | admin, operator, user |
| `POST`   | `/api/agents` | admin, operator |
| `GET`    | `/api/agents/:id` | admin, operator, user |
| `PATCH`  | `/api/agents/:id` | admin, operator |
| `DELETE` | `/api/agents/:id` | admin |
| `GET`    | `/api/agents/:id/tools` | admin, operator |
| `POST`   | `/api/agents/:id/tools` | admin, operator |
| `DELETE` | `/api/agents/:id/tools/:toolId` | admin, operator |

### 6.3 Tools

| Method | Path | Roles |
|--------|------|-------|
| `GET`    | `/api/tools` | admin, operator, user |
| `POST`   | `/api/tools` | admin |
| `GET`    | `/api/tools/:id` | admin, operator |
| `PATCH`  | `/api/tools/:id` | admin |
| `DELETE` | `/api/tools/:id` | admin |
| `POST`   | `/api/tools/:id/test` | admin, operator |

### 6.4 MCP

انظر `MCP.md` قسم 10.

### 6.5 Sessions & Messages

| Method | Path | Roles | ملاحظة |
|--------|------|-------|--------|
| `GET`    | `/api/sessions` | all | جلسات المستخدم |
| `POST`   | `/api/sessions` | all | إنشاء جلسة |
| `GET`    | `/api/sessions/:id` | all | تفاصيل |
| `DELETE` | `/api/sessions/:id` | all | حذف |
| `GET`    | `/api/sessions/:id/messages` | all | الرسائل |
| `POST`   | `/api/sessions/:id/messages` | all | **Streaming** |
| `GET`    | `/api/sessions/:id/artifacts` | all | المخرجات |
| `GET`    | `/api/sessions/:id/cost` | all | التكلفة |
| `POST`   | `/api/sessions/:id/cancel` | all | إلغاء تنفيذ جارٍ |
| `POST`   | `/api/sessions/:id/resume` | all | استئناف بعد انقطاع |

### 6.6 Workflows

| Method | Path | Roles |
|--------|------|-------|
| `GET`    | `/api/workflows` | admin, operator |
| `POST`   | `/api/workflows` | admin, operator |
| `GET`    | `/api/workflows/:id` | admin, operator |
| `PATCH`  | `/api/workflows/:id` | admin, operator |
| `DELETE` | `/api/workflows/:id` | admin |
| `POST`   | `/api/workflows/:id/runs` | all | بدء run |
| `GET`    | `/api/workflows/runs/:runId` | all | حالة run |
| `POST`   | `/api/workflows/runs/:runId/cancel` | all |
| `POST`   | `/api/workflows/runs/:runId/resume` | all |
| `GET`    | `/api/workflows/runs/:runId/steps` | all |

### 6.7 Memory

| Method | Path | Roles |
|--------|------|-------|
| `GET`    | `/api/memory` | all | ذاكرة المستخدم |
| `POST`   | `/api/memory` | all | تخزين حقيقة |
| `DELETE` | `/api/memory/:id` | all | حذف سجل |
| `POST`   | `/api/memory/search` | all | بحث دلالي |
| `POST`   | `/api/memory/forget` | all | نسيان جماعي |
| `GET`    | `/api/memory/entities` | all | الكيانات |
| `GET`    | `/api/memory/stats` | all | إحصائيات |

### 6.8 RAG / Documents

| Method | Path | Roles |
|--------|------|-------|
| `POST`   | `/api/documents/upload` | all | رفع مستند |
| `GET`    | `/api/documents` | all | القائمة |
| `DELETE` | `/api/documents/:id` | all | حذف |
| `POST`   | `/api/documents/query` | all | استعلام دلالي |
| `GET`    | `/api/documents/:id/chunks` | all | الـ chunks |

### 6.9 Background Jobs

| Method | Path | Roles |
|--------|------|-------|
| `GET`    | `/api/jobs` | admin, operator | قائمة |
| `GET`    | `/api/jobs/:id` | admin, operator | تفاصيل |
| `POST`   | `/api/jobs/:id/retry` | admin, operator | إعادة |
| `POST`   | `/api/jobs/:id/cancel` | admin, operator | إلغاء |
| `GET`    | `/api/queues` | admin | حالة الطوابير |
| `GET`    | `/api/queues/:name/metrics` | admin | مقاييس |

### 6.10 Users & RBAC

| Method | Path | Roles |
|--------|------|-------|
| `GET`    | `/api/users` | admin |
| `POST`   | `/api/users` | admin |
| `PATCH`  | `/api/users/:id` | admin |
| `DELETE` | `/api/users/:id` | admin |
| `GET`    | `/api/roles` | admin |
| `POST`   | `/api/roles` | admin |
| `PATCH`  | `/api/roles/:id` | admin |
| `POST`   | `/api/users/:id/roles` | admin |
| `GET`    | `/api/permissions` | admin |

### 6.11 Cost & Analytics

| Method | Path | Roles |
|--------|------|-------|
| `GET`    | `/api/costs/summary` | all | ملخص التكلفة |
| `GET`    | `/api/costs/breakdown` | all | تفصيل حسب model/provider |
| `GET`    | `/api/costs/timeseries` | all | سلسلة زمنية |
| `GET`    | `/api/costs/budgets` | all | الميزانيات |
| `POST`   | `/api/costs/budgets` | admin, user | إنشاء ميزانية |
| `PATCH`  | `/api/costs/budgets/:id` | admin, user | تعديل |
| `GET`    | `/api/analytics/usage` | admin, operator | تحليلات الاستخدام |
| `GET`    | `/api/analytics/agents` | admin, operator | أداء الوكلاء |
| `GET`    | `/api/analytics/tools` | admin, operator | استخدام الأدوات |

### 6.12 Observability

| Method | Path | Roles |
|--------|------|-------|
| `GET`    | `/api/logs` | admin | سجلات (filterable) |
| `GET`    | `/api/traces/:traceId` | admin | trace كامل |
| `GET`    | `/api/metrics` | admin | مقاييس نظام |
| `GET`    | `/api/health` | all | فحص الصحة (public) |
| `GET`    | `/api/audit` | admin | سجل التدقيق |

### 6.13 Storage & Artifacts

| Method | Path | Roles |
|--------|------|-------|
| `POST`   | `/api/storage/upload` | all | رفع ملف |
| `GET`    | `/api/storage/:key` | all | تنزيل |
| `DELETE` | `/api/storage/:key` | all | حذف |
| `GET`    | `/api/artifacts/:id` | all | تنزيل artifact |

---

## 7. الـ WebSocket Events

للأحداث real-time (progress، streaming من background jobs):

```javascript
const socket = io('/?XTransformPort=3003');

socket.emit('subscribe', { sessionId: '...' });

socket.on('session.message', (e) => { ... });
socket.on('session.tool_call', (e) => { ... });
socket.on('session.completed', (e) => { ... });
socket.on('workflow.step.completed', (e) => { ... });
socket.on('job.progress', (e) => { ... });
```

---

## 8. الـ Pagination

```http
GET /api/sessions?page=1&limit=20&sort=createdAt:desc
```

Response:
```json
{
  "success": true,
  "data": [...],
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 145,
      "totalPages": 8
    }
  }
}
```

---

## 9. الـ Filtering & Search

```http
GET /api/sessions?status=active&agentId=...&createdAfter=2024-01-01
GET /api/messages?sessionId=...&role=user&contentContains=hello
```

كل queries تُحقَّق من SQL injection عبر Drizzle's parameterized queries.

---

## 10. أمثلة كاملة

### 10.1 إنشاء جلسة وإرسال رسالة

```bash
# 1. إنشاء جلسة
curl -X POST https://your-domain.com/api/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "planner", "title": "Test"}'

# Response: { "data": { "id": "sess_123", ... } }

# 2. إرسال رسالة (streaming)
curl -N -X POST https://your-domain.com/api/sessions/sess_123/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"content": "Plan a marketing campaign for X"}'
```

### 10.2 بدء workflow

```bash
curl -X POST https://your-domain.com/api/workflows/wf_research/runs \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"input": {"topic": "AI in healthcare"}}'

# Response: { "data": { "runId": "run_456", "status": "running" } }

# متابعة الحالة
curl https://your-domain.com/api/workflows/runs/run_456
```

---

## 11. SDK (مستقبلاً)

في المرحلة 7، سيتم بناء SDK لـ:
- JavaScript/TypeScript
- Python

لتسهيل الاستهلاك بدون التعامل المباشر مع HTTP.

```typescript
import { AgentClient } from '@platform/sdk';

const client = new AgentClient({ apiKey: '...' });
const session = await client.sessions.create({ agentId: 'planner' });
const stream = await session.messages.stream('Hello');
for await (const chunk of stream) {
  console.log(chunk);
}
```

---

## 12. الاعتبارات الإنتاجية

- **CORS**: configurable per-tenant
- **HTTPS only**: في الإنتاج
- **Request size limit**: 10 MB (للرفع 100 MB)
- **Timeout**: 30 ثانية لكل request (Streaming مستثنى)
- **Compression**: gzip / brotli
- **ETag**: للـ GET responses
- **Idempotency-Key**: للـ POSTs الحساسة (payments، cost-bearing)

---

## 13. أمثلة الأخطاء الشائعة

```json
// 401 — Token منتهي
{
  "success": false,
  "error": {
    "code": "TOKEN_EXPIRED",
    "message": "Access token expired. Use refresh token."
  }
}

// 403 — صلاحيات ناقصة
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_PERMISSIONS",
    "message": "Requires role: admin"
  }
}

// 422 — ميزانية تجاوزت
{
  "success": false,
  "error": {
    "code": "BUDGET_EXCEEDED",
    "message": "Daily budget of $5.00 exceeded ($5.23 used)"
  }
}

// 429 — Rate limit
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Retry after 30s."
  }
}
```
