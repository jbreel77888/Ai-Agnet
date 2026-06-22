# MCP — Model Context Protocol

> وثيقة تصميم عميل MCP: الاتصال بالـ MCP Servers، اكتشاف الأدوات، إعادة التحميل الديناميكي.

---

## 1. ما هو MCP؟

**Model Context Protocol** هو معيار مفتوح من Anthropic يتيح لخوادم خارجية (MCP Servers) تقديم **أدوات** و**موارد** و**prompts** للوكلاء بشكل موحّد. هذا يسمح للمنصة بـ:

- إضافة أدوات خارجية بدون كتابة كود
- استخدام أدوات مجتمعية (filesystem, browser, github, slack, إلخ)
- تشغيل MCP Servers محلياً (stdio) أو بعيداً (SSE/WebSocket/HTTP)

---

## 2. أنواع النقل (Transport Types)

| النوع | متى يُستخدم | الميزات | القيود |
|------|-------------|---------|--------|
| `stdio` | MCP server محلي على نفس الخادم | الأسرع، أبسط | يتطلب تشغيل process على الخادم |
| `sse` | MCP server بعيد عبر HTTP | يدعم load balancing | لا يدعم streaming ثنائي الاتجاه |
| `websocket` | MCP server بعيد، تفاعل ثنائي | realtime | يحتاج WebSocket server |
| `http` | REST-style MCP server | بسيط | polling بدلاً من push |

### مثال: stdio MCP Server

```yaml
name: filesystem-mcp
slug: filesystem_mcp
transport: stdio
command: npx
args: ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
auth_type: none
```

### مثال: SSE MCP Server

```yaml
name: remote-tools
slug: remote_tools
transport: sse
url: https://my-mcp-server.com/sse
auth_type: bearer
auth_credentials_encrypted: <encrypted_token>
```

---

## 3. الـ MCP Client

```typescript
interface MCPClient {
  // دورة حياة
  connect(serverConfig: MCPServerConfig): Promise<MCPSession>;
  disconnect(serverId: string): Promise<void>;
  reconnect(serverId: string): Promise<void>;

  // اكتشاف
  listTools(serverId: string): Promise<MCPTool[]>;
  listResources(serverId: string): Promise<MCPResource[]>;
  listPrompts(serverId: string): Promise<MCPPrompt[]>;

  // التنفيذ
  callTool(serverId: string, toolName: string, args: unknown): Promise<MCPToolResult>;
  readResource(serverId: string, uri: string): Promise<MCPResourceContent>;
  getPrompt(serverId: string, name: string, args?: Record<string, string>): Promise<MCPPromptResult>;

  // الصحة
  healthCheck(serverId: string): Promise<MCPHealth>;
  ping(serverId: string): Promise<boolean>;
}

interface MCPSession {
  serverId: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  transport: TransportType;
  lastPingAt: Date;
  toolsCache: MCPTool[];
  resourcesCache: MCPResource[];
  startedAt: Date;
}
```

---

## 4. تسجيل MCP Servers

### من لوحة التحكم

1. الإدارة → MCP Servers → "Add Server"
2. تعبئة النموذج (name, transport, command/url, auth)
3. الضغط على "Connect & Discover"
4. النظام:
   - يشفّر الـ credentials
   - يحفظ في `mcp_servers`
   - يحاول الاتصال
   - يجلب قائمة الأدوات
   - يضيف كل أداة إلى `mcp_tools` و `tools` (مع `source='mcp'`)
   - يحدّث الـ Tool Registry
   - يصدر event `mcp.tools.registered`

### من API

```http
POST /api/mcp/servers
Content-Type: application/json
Authorization: Bearer <admin_token>

{
  "name": "Filesystem MCP",
  "slug": "filesystem_mcp",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
  "auth_type": "none"
}
```

---

## 5. إعادة التحميل الديناميكي

**متطلب أساسي**: إضافة/تعديل أدوات MCP بدون إعادة تشغيل النظام.

### الآلية

```typescript
// عند تعديل MCP server من لوحة التحكم:
async function reloadMCPServer(serverId: string) {
  // 1. قطع الاتصال الحالي
  await mcpClient.disconnect(serverId);

  // 2. إعادة الاتصال
  const session = await mcpClient.connect(serverConfig);

  // 3. جلب الأدوات الجديدة
  const tools = await mcpClient.listTools(serverId);

  // 4. مقارنة مع الأدوات القديمة
  const oldTools = await db.mcpTools.findByServerId(serverId);
  const { added, modified, removed } = diffTools(oldTools, tools);

  // 5. تحديث DB
  for (const t of added) await db.mcpTools.insert(t);
  for (const t of modified) await db.mcpTools.update(t);
  for (const t of removed) await db.mcpTools.deactivate(t);

  // 6. تحديث Tool Registry
  for (const t of added) toolRegistry.register(toMCPToolAdapter(t));
  for (const t of modified) toolRegistry.update(t.name, toMCPToolAdapter(t));
  for (const t of removed) toolRegistry.unregister(t.name);

  // 7. إشعار الوكلاء النشطين
  eventBus.emit('tools.changed', { serverId, added, modified, removed });
}
```

### المزامنة الدورية

كل 5 دقائق، الـ MCP Health Worker يقوم بـ:
- `ping` كل MCP server
- لو فشل ping 3 مرات → status='degraded'
- لو فشل 10 مرات → status='error' + محاولة reconnect
- كل 1 ساعة → `listTools` ومقارنة مع DB (لو تغيّرت)

---

## 6. MCP Tools في الـ Tool Registry

كل أداة MCP تُغلَّف بـ `MCPToolAdapter`:

```typescript
class MCPToolAdapter implements ITool {
  constructor(
    private serverId: string,
    private mcpTool: MCPTool,
    private mcpClient: MCPClient
  ) {}

  get id() { return `mcp:${this.serverId}:${this.mcpTool.name}`; }
  get name() { return this.mcpTool.name; }
  get description() { return this.mcpTool.description; }
  get schema() { return this.mcpTool.inputSchema; }
  get category() { return 'mcp'; }

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now();
    try {
      const result = await this.mcpClient.callTool(
        this.serverId,
        this.mcpTool.name,
        args
      );
      return {
        success: !result.isError,
        data: result.content,
        metadata: { durationMs: Date.now() - start }
      };
    } catch (e) {
      return {
        success: false,
        error: { code: 'MCP_ERROR', message: e.message },
        metadata: { durationMs: Date.now() - start }
      };
    }
  }
}
```

بهذا، الوكلاء يتعاملون مع أدوات MCP **بنفس طريقة** Built-in Tools.

---

## 7. الأمان

### 1. عزل الـ stdio servers

MCP servers تُشغّل في process منفصل مع:
- `cwd` محجوز (`/var/mcp/workers/{serverId}/`)
- متغيرات بيئة محدودة (فقط الممرّرة في `env_vars_encrypted`)
- لا وصول لـ `process.env` الخاص بالمنصة

### 2. تصفية الأدوات

يمكن للأدمن:
- تفعيل/تعطيل أداة MCP معينة دون إعادة اتصال
- إضافة `required_permissions` لأداة MCP
- تحديد `rate_limit_per_min` لكل أداة

### 3. مراجعة الأدوات الجديدة

عند اكتشاف أدوات جديدة من MCP server:
- تُضاف بحالة `pending_approval` (إن كان الإعداد يطلب ذلك)
- تظهر في لوحة التحكم → MCP → "Pending Tools"
- الأدمن يرى الـ schema، يقرر الموافقة/الرفض

### 4. Credentials Encryption

كل من:
- `auth_credentials_encrypted`
- `env_vars_encrypted`

مشفر AES-256-GCM باستخدام `ENCRYPTION_KEY`. لا تظهر في الـ API responses (تُستبدل بـ `***`).

---

## 8. المراقبة

| المقياس | الوصف |
|--------|------|
| `mcp.server.uptime` | زمن التشغيل منذ آخر connect |
| `mcp.server.tool_calls` | عدد استدعاءات الأدوات |
| `mcp.server.errors` | عدد الأخطاء |
| `mcp.server.latency_ms` | زمن الاستجابة (p50/p95) |
| `mcp.tool.calls` | استدعاءات لكل أداة |
| `mcp.tool.errors` | أخطاء لكل أداة |

كل هذه تُسجّل في `metrics` table وتُعرض في لوحة التحكم.

---

## 9. أمثلة MCP Servers شائعة

### Filesystem
```yaml
transport: stdio
command: npx
args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
```

### GitHub
```yaml
transport: stdio
command: npx
args: ["-y", "@modelcontextprotocol/server-github"]
env_vars:
  GITHUB_PERSONAL_ACCESS_TOKEN: <encrypted>
```

### Postgres
```yaml
transport: stdio
command: npx
args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://..."]
```

### Slack
```yaml
transport: stdio
command: npx
args: ["-y", "@modelcontextprotocol/server-slack"]
env_vars:
  SLACK_BOT_TOKEN: <encrypted>
  SLACK_TEAM_ID: T...
```

### Browser Automation (Playwright)
```yaml
transport: stdio
command: npx
args: ["-y", "@modelcontextprotocol/server-playwright"]
```

---

## 10. الـ API Endpoints

| الـ Method | الـ Path | الوصف |
|-----------|---------|--------|
| `GET` | `/api/mcp/servers` | قائمة الـ servers |
| `POST` | `/api/mcp/servers` | إضافة server جديد |
| `GET` | `/api/mcp/servers/:id` | تفاصيل server |
| `PATCH` | `/api/mcp/servers/:id` | تعديل |
| `DELETE` | `/api/mcp/servers/:id` | حذف |
| `POST` | `/api/mcp/servers/:id/connect` | اتصال يدوي |
| `POST` | `/api/mcp/servers/:id/disconnect` | قطع اتصال |
| `POST` | `/api/mcp/servers/:id/refresh` | إعادة اكتشاف الأدوات |
| `GET` | `/api/mcp/servers/:id/tools` | قائمة الأدوات |
| `PATCH` | `/api/mcp/tools/:id` | تعديل أداة (enable/disable, permissions) |

---

## 11. الاعتبارات الإنتاجية

### 1. Limits
- أقصى عدد MCP servers لكل tenant: 50
- أقصى عدد أدوات لكل server: 200
- أقصى timeout لـ tool call: 60 ثانية
- أقصى حجم response: 10 MB

### 2. Cleanup
- عند حذف MCP server:
  - تُعطَّل كل أدواته في `tools`
  - تُحذف من `mcp_tools`
  - الـ sessions النشطة تستمر (لو لا تزال تستخدم الأداة، تُحفظ في message)
  - تُقطع العملية (لـ stdio)

### 3. Versioning
- كل MCP server له `version` (من protocol handshake)
- لو تغيّر بروتوكول MCP، النظام يدعم عدة إصدارات بالتوازي

---

## 12. التوسع المستقبلي

- **MCP Resources**: قراءة موارد (ملفات، DB records) من MCP servers
- **MCP Prompts**: قوالب prompts جاهزة من MCP
- **MCP Marketplace**: تصفّح وتثبيت MCP servers من سجل مجتمعي
- **Custom MCP Servers**: SDK مدمج لبناء MCP server داخل المنصة
- **MCP-to-Tool Bridge**: نشر أدوات المنصة كـ MCP server لأطراف خارجية
