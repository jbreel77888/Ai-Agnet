# Ai Norx

منصة وكيل ذكي مركزية لتنفيذ المهام بالذكاء الاصطناعي.

## المميزات

- **وكيل ذكي مركزي** — وكيل واحد فقط تتحكم به الإدارة، يستخدمه جميع المستخدمين
- **تنفيذ الكود** — Python, JavaScript, Bash في sandbox آمن (Tensorlake)
- **بحث الويب** — بحث مُحسّن للذكاء الاصطناعي (Tavily)
- **ذاكرة طويلة الأمد** — حفظ تفضيلات المستخدم بين المحادثات (mem0)
- **مراقبة الأخطاء** — تتبع شامل للأخطاء (Sentry)
- **تخزين الملفات** — تخزين سحابي موثوق (Cloudflare R2)
- **أتمتة المتصفح** — تحكم كامل بالمتصفح (Browserless)
- **دعم العربية** — واجهة عربية أولاً + متعدد اللغات

## البنية التقنية

| الطبقة | التقنية |
|---|---|
| Frontend | React 19 + Vite + TailwindCSS |
| Backend | Node.js 24 + Express 5 |
| Database | MongoDB 8 |
| Cache | Redis 7 |
| Code Sandbox | Tensorlake MicroVM |
| Vector DB | Pinecone |
| Object Storage | Cloudflare R2 |

## التطوير المحلي

```bash
# تثبيت الاعتماديات
npm install

# تشغيل التطوير
npm run dev

# البناء للإنتاج
npm run frontend
npm run backend
```

## متغيرات البيئة المطلوبة

انسخ `.env.example` إلى `.env` واملأ القيم التالية:

```
MONGO_URI=...
REDIS_URI=...
TENSORLAKE_API_KEY=...
TAVILY_API_KEY=...
MEM0_API_KEY=...
SENTRY_DSN=...
NVIDIA_API_KEY=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=ainorx
R2_ENDPOINT=...
PINECONE_API_KEY=...
JINA_API_KEY=...
BROWSERLESS_API_KEY=...
GITHUB_PERSONAL_ACCESS_TOKEN=...
APP_TITLE=Ai Norx
```

## النشر

النشر يتم تلقائياً عبر Railway عند push إلى فرع `main`.

```
Production: https://agent-platform-production-de14.up.railway.app
```

## الاعتمادات

هذا المشروع مبني على [LibreChat](https://github.com/danny-avila/LibreChat) (رخصة MIT).

## الرخصة

MIT License — Copyright (c) 2026 Ai Norx
