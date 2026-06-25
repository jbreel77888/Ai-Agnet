/**
 * setup-primary-agent.js
 *
 * Creates or updates the "primary-agent" in the database — the single
 * central agent that all USER-role conversations will use.
 *
 * Usage:
 *   node config/setup-primary-agent.js
 *
 * Env vars required:
 *   MONGO_URI    — MongoDB connection string
 *
 * The script:
 *   1. Connects to MongoDB
 *   2. Finds (or creates) the admin user — author of the primary agent
 *   3. Upserts the primary-agent document with our default config
 *   4. Grants ACL: ADMIN = full, USER = USE only
 *   5. Disables Permissions.CREATE on USER role (migration)
 *   6. Creates a test USER account for QA
 */
const path = require('path');
require('module-alias/register');
const moduleAlias = require('module-alias');
const basePath = path.resolve(__dirname, '..', 'api');
moduleAlias.addAlias('~', basePath);

const mongoose = require('mongoose');
const { createModels } = require('@librechat/data-schemas');
const { SystemRoles, PermissionTypes, Permissions, ResourceType, PrincipalType } = require('librechat-data-provider');
const bcrypt = require('bcryptjs');

// Register all Mongoose models before requiring db methods
createModels(mongoose);

const db = require('~/models');

const PRIMARY_AGENT_ID = 'agent_primary';
const ADMIN_EMAIL = 'admin@agent-platform.local';
const TEST_USER_EMAIL = 'tester@ai-norx.com';
const TEST_USER_PASSWORD = 'Tester123!';

const primaryAgentConfig = {
  id: PRIMARY_AGENT_ID,
  name: 'Ai Norx',
  description: 'الوكيل المركزي للمنصة — يستخدم لجميع محادثات المستخدمين العاديين',
  instructions: `أنت Ai Norx، وكيل ذكي تم تطويره بواسطة منصة Ai Norx.
تعمل في بيئة Linux sandbox متكاملة (Ubuntu systemd) مع اتصال بالإنترنت وصلاحيات كاملة.

# بيئة العمل — Linux Sandbox متكامل (وليس مجرد Python)
الـ sandbox الخاص بك هو جهاز Linux حقيقي (Ubuntu) يعمل بنظام systemd. يمكنك القيام بكل ما يفعله أي خادم Linux:
- تثبيت أي حزمة: apt-get install, pip install, npm install -g, cargo install
- تشغيل أي أوامر shell: curl, wget, git, ssh, tar, gzip, jq, ffmpeg, imagemagick
- بناء وتشغيل مواقع وتطبيقات: node server.js, python -m http.server, nginx
- إدارة الملفات: إنشاء، تعديل، نقل، نسخ، أرشفة، ضغط
- تشغيل عمليات طويلة أو متعددة (background processes)
- الوصول للإنترنت: تنزيل ملفات، استدعاء APIs، فحص مواقع
- العمل بقواعد البيانات: sqlite, postgres-client, redis-cli
- معالجة الصور والفيديو: ffmpeg, imagemagick, pillow
- تحليل بيانات ضخمة: pandas, numpy, scipy, matplotlib
- توليد ملفات بأي صيغة: CSV, JSON, HTML, PDF, PNG, SVG, Excel

**الأداة tensorlake_code_interpreter هي بوابتك لهذا الـ sandbox الكامل.** استخدم لغة:
- "bash" (الافتراضية) — لأي أوامر Linux: تثبيت حزم، تنزيل ملفات، إنشاء ملفات (echo > file)، إدارة النظام، ffmpeg، curl، git
- "python" — لتحليل البيانات (pandas, numpy)، الرسم البياني (matplotlib)، السكربتات المعقدة
- "javascript" — لتشغيل Node.js

## قاعدة المسارات (حرج جداً)
الـ sandbox هو **جهاز منفصل** عن خادم المنصة. جميع مسارات الملفات يجب أن تكون داخل:
- ✅ /home/tl-user/  (هذا هو الـ home directory في الـ sandbox — استخدمه دائماً)
- ✅ /tmp/  (للملفات المؤقتة)

مسارات ممنوعة (لا وجود لها في الـ sandbox وستفشل مع FileNotFoundError):
- ❌ /app/uploads/agent-workspace/  (هذا موجود في خادم المنصة وليس الـ sandbox!)
- ❌ /app/* و /uploads/* و /api/*

أمثلة صحيحة:
- echo "مرحبا" > /home/tl-user/file.txt
- curl -o /home/tl-user/data.json https://api.example.com/data
- python3 /home/tl-user/script.py

الـ sandbox دائم: الملفات والحزم والبيانات تبقى بين الاستدعاءات.

# المهام التي تتفوق فيها
1. بناء وتشغيل مواقع وتطبيقات كاملة (frontend + backend + DB)
2. معالجة وتحليل البيانات الضخمة وتصويرها
3. كتابة المقالات المتعددة الفصول والتقارير المعمقة
4. أتمتة المهام: scraping, ETL, pipeline, scheduled jobs
5. توليد ملفات بأي صيغة (PDF, Excel, صور, فيديو)
6. تجميع المعلومات والتحقق من الحقائق والتوثيق
7. معالجة الصور والفيديو والملفات الثنائية

# اللغة الافتراضية
- استخدم لغة المستخدم (عربي افتراضياً)
- الفكر والردود يجب أن تكون بلغة المستخدم
- تجنب القوائم النقطية الخالصة، استخدم الفقرات

# دورة التنفيذ
1. حلل الأحداث: افهم احتياجات المستخدم
2. اختر الأداة: اختر الأداة التالية المناسبة
3. انتظر التنفيذ: الأداة ستُنفّذ وتعيد الملاحظات
4. كرّر: أداة واحدة فقط لكل دورة
5. سلّم النتائج: أرسل النتائج للمستخدم
6. ادخل الاستعداد: عند الانتهاء

# قواعد استخدام الأدوات (مهم جداً)
- لا تستدعِ أي أداة تلقائياً عند بدء المحادثة. أولاً افهم طلب المستخدم.
- لا تبحث في الويب إلا إذا كان الطلب يتطلب معلومات حديثة لا تعرفها أو تحتاج للتحقق منها.
- للأسئلة العامة (مثل "من أنت؟"، "مرحبا"، "كيف حالك") لا تستخدم أي أداة، فقط ردّ مباشرة.
- للأسئلة المعرفية التي تعرف إجابتها (مثل "ما هي عاصمة فرنسا؟") لا تبحث، فقط أجب من معرفتك.
- استخدم البحث في الويب فقط عندما: 
  • يطلب المستخدم صراحة معلومات حديثة (الأخبار، الأسعار، الأحداث الجارية)
  • الموضوع متغيّر بسرعة (نتائج المباريات، أسعار الأسهم)
  • تحتاج للتحقق من معلومة للوصول إلى نتيجة دقيقة
  • المعلومات غير موجودة في معرفتك الداخلية
- استخدم الـ sandbox (tensorlake_code_interpreter) لكل ما يتطلب تنفيذاً فعلياً:
  • كتابة وتشغيل أي كود (Python, JS, Bash)
  • تثبيت حزم أو أدوات (apt, pip, npm, cargo)
  • بناء مواقع أو تطبيقات كاملة
  • تحليل بيانات أو حسابات معقدة
  • توليد ملفات (CSV, JSON, HTML, PDF, PNG, SVG, Excel)
  • أتمتة مهام (scraping, ETL, pipelines)
  • معالجة صور/فيديو (ffmpeg, imagemagick)
  • تنزيل ملفات أو استدعاء APIs خارجية
  • إدارة قواعد بيانات
- استخدم الآلة الحاسبة (calculator) للعمليات الحسابية البسيطة فقط.
- استخدم أدوات GitHub (mcp_github) عندما يطلب المستخدم:
  • إنشاء أو مراجعة Pull Request أو Issue
  • البحث في مستودعات GitHub
  • قراءة محتوى ملف من GitHub
- استخدم أداة Fetch (mcp_fetch) عندما تحتاج لقراءة محتوى صفحة ويب محددة (URL) وتحويلها لـ Markdown.
- استخدم أدوات Filesystem (mcp_filesystem) عندما تحتاج لحفظ ملفات دائمة عبر المحادثات (تقارير، ملاحظات، ملفات وسيطة) — هذا تخزين منفصل عن الـ sandbox المؤقت.

# القواعد العامة
- يجب دائماً استخدام أداة (function call) فقط عند الحاجة الفعلية لها؛ ردّ نصياً مباشرة إذا لم تكن بحاجة لأداة
- لا تذكر أسماء الأدوات للمستخدم في الرسائل
- احفظ الكود في ملفات قبل التنفيذ (في /home/tl-user/)
- استخدم -y أو -f للأوامر التي تتطلب تأكيداً
- صل الأوامر بـ && لتقليل الانقطاعات
- اكتب بفقرات مستمرة، تجنب القوائم إلا عند الطلب
- الكتابة يجب أن تكون مفصّلة (آلاف الكلمات) إلا إذا طلب المستخدم غير ذلك
- احفظ النتائج الوسيطة في ملفات منفصلة
- أولوية المعلومات: datasource API > بحث الويب > المعرفة الداخلية
- ردّ فوراً على رسائل المستخدم الجديدة قبل أي عمليات أخرى
- الرد الأول يجب أن يكون مختصراً (تأكيد الاستلام فقط)

# معالجة الأخطاء
- عند فشل أداة، تحقق من الاسم والمعطيات
- حاول إصلاح المشكلة بناءً على رسالة الخطأ
- جرب طرقاً بديلة
- عند فشل عدة محاولات، أبلغ المستخدم واطلب المساعدة`,
  provider: 'OpenCodez',
  model: 'deepseek-v4-flash-free',
  model_parameters: {
    temperature: 0.7,
    top_p: 1,
  },
  tools: [
    'tensorlake_code_interpreter',
    'web_search',
    'calculator',
    // MCP servers — 'sys__all__sys' means "all tools from this server"
    // Format: sys__all__sys_mcp_<serverName>
    'sys__all__sys_mcp_github',
    'sys__all__sys_mcp_fetch',
    'sys__all__sys_mcp_filesystem',
  ],
  // MCP server names (for efficient querying)
  mcpServerNames: ['github', 'fetch', 'filesystem'],
  recursion_limit: 50,
  access_level: 0,
  end_after_tools: false,
  hide_sequential_outputs: false,
  conversation_starters: [
    'اكتب لي سكربت بايثون يحسب أول 10 أرقام فيبوناتشي',
    'ابحث عن أحدث أخبار الذكاء الاصطناعي',
    'حلّل هذه البيانات وأنشئ لي رسم بياني',
    'ساعدني في كتابة مقال عن التغير المناخي',
  ],
  category: 'general',
  is_promoted: true,
};

async function setupPrimaryAgent() {
  console.log('Connecting to MongoDB...');
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI env var is required');
  }

  await mongoose.connect(mongoUri);
  console.log('✓ Connected to MongoDB');

  // Initialize roles
  console.log('Seeding database (roles, categories)...');
  await db.seedDatabase();
  console.log('✓ Database seeded');

  // Find admin user
  console.log('Finding admin user...');
  const adminUser = await db.findUser({ email: ADMIN_EMAIL });
  if (!adminUser) {
    throw new Error(`Admin user not found with email: ${ADMIN_EMAIL}. Run the create-admin script first.`);
  }
  console.log(`✓ Found admin user: ${adminUser.email} (${adminUser._id})`);

  // Upsert primary agent (also migrate from legacy 'primary-agent' ID if present)
  console.log('Upserting primary-agent...');
  // First: migrate legacy 'primary-agent' to 'agent_primary' if it exists
  const Agent = mongoose.models.Agent;
  await Agent.updateOne(
    { id: 'primary-agent' },
    { $set: { id: PRIMARY_AGENT_ID } },
  );
  // Also migrate conversations referencing the old ID
  const Conv = mongoose.models.Conversation;
  await Conv.updateMany(
    { agent_id: 'primary-agent' },
    { $set: { agent_id: PRIMARY_AGENT_ID, model: PRIMARY_AGENT_ID } },
  );
  let agent = await db.getAgent({ id: PRIMARY_AGENT_ID });
  const agentData = {
    ...primaryAgentConfig,
    author: adminUser._id,
    authorName: adminUser.name || adminUser.username || 'Admin',
  };

  // ── SEED-ONCE POLICY ───────────────────────────────────────────────────
  // CRITICAL FIX: Do NOT overwrite an existing agent_primary.
  // Previous behavior: db.updateAgent() clobbered the entire document with
  // hardcoded Arabic instructions every time this script ran — wiping out
  // any edits the Admin made via the UI.
  //
  // New behavior: only create the agent if it doesn't exist. If it exists,
  // preserve ALL admin edits. We still ensure ACL grants are in place
  // (idempotent) and ensure the agent is marked as default (idempotent).
  if (agent) {
    console.log(`✓ Primary agent already exists (id: ${agent.id}). Skipping content overwrite — admin edits preserved.`);

    // Idempotent: ensure isDefault flag is set (does NOT touch instructions/tools/model)
    if (!agent.isDefault) {
      try {
        agent = await db.updateAgent(
          { id: PRIMARY_AGENT_ID },
          { isDefault: true, defaultForRoles: [SystemRoles.USER, SystemRoles.ADMIN] },
        );
        console.log('  ✓ Marked existing agent as default (isDefault=true)');
      } catch (err) {
        console.error('  ⚠ Failed to set isDefault on existing agent:', err.message);
      }
    } else {
      console.log('  ✓ isDefault already set — no changes needed');
    }
  } else {
    agent = await db.createAgent({
      ...agentData,
      isDefault: true,
      defaultForRoles: [SystemRoles.USER, SystemRoles.ADMIN],
    });
    console.log(`✓ Created new primary-agent: ${agent._id} (marked as default)`);
  }

  // Grant ACL permissions
  console.log('Setting ACL permissions...');
  const adminRole = await db.getRoleByName(SystemRoles.ADMIN);
  const userRole = await db.getRoleByName(SystemRoles.USER);

  if (adminRole && userRole) {
    // Permission bits: 1=USE, 2=CREATE/EDIT, 4=UPDATE, 8=DELETE, 16=SHARE
    // IMPORTANT: For PrincipalType.ROLE, principalId must be the role NAME string
    // (e.g., 'ADMIN', 'USER'), NOT the role's _id (ObjectId).
    // This matches how getUserPrincipals() builds the principal list.

    // ADMIN — full access (all bits, max=15: USE+EDIT+UPDATE+DELETE)
    try {
      await db.grantPermission(
        PrincipalType.ROLE,
        SystemRoles.ADMIN,  // role NAME string, not _id
        ResourceType.AGENT,
        agent._id,
        15, // USE+EDIT+UPDATE+DELETE (max value allowed by schema)
        adminUser._id,
        null,
        adminRole._id,
      );
      console.log('  ✓ ADMIN role: full access (USE+EDIT+UPDATE+DELETE)');
    } catch (err) {
      console.error('  ✗ ADMIN grant failed:', err.message);
    }

    // USER — USE only (bit 1)
    try {
      await db.grantPermission(
        PrincipalType.ROLE,
        SystemRoles.USER,  // role NAME string, not _id
        ResourceType.AGENT,
        agent._id,
        1, // USE only
        adminUser._id,
        null,
        userRole._id,
      );
      console.log('  ✓ USER role: USE only');
    } catch (err) {
      console.error('  ✗ USER grant failed:', err.message);
    }
  }

  // Restrict USER role permissions — disable CREATE
  console.log('Restricting USER role permissions...');
  const Role = mongoose.models.Role;
  const userRoleUpdates = {
    [`permissions.${PermissionTypes.AGENTS}.${Permissions.CREATE}`]: false,
    [`permissions.${PermissionTypes.AGENTS}.${Permissions.SHARE}`]: false,
    [`permissions.${PermissionTypes.AGENTS}.${Permissions.SHARE_PUBLIC}`]: false,
    [`permissions.${PermissionTypes.PROMPTS}.${Permissions.CREATE}`]: false,
    [`permissions.${PermissionTypes.PROMPTS}.${Permissions.SHARE}`]: false,
    [`permissions.${PermissionTypes.PROMPTS}.${Permissions.SHARE_PUBLIC}`]: false,
    [`permissions.${PermissionTypes.MCP_SERVERS}.${Permissions.CREATE}`]: false,
    [`permissions.${PermissionTypes.MCP_SERVERS}.${Permissions.SHARE}`]: false,
    [`permissions.${PermissionTypes.MCP_SERVERS}.${Permissions.SHARE_PUBLIC}`]: false,
    [`permissions.${PermissionTypes.MCP_SERVERS}.${Permissions.CONFIGURE_OBO}`]: false,
    [`permissions.${PermissionTypes.REMOTE_AGENTS}.${Permissions.USE}`]: false,
    [`permissions.${PermissionTypes.REMOTE_AGENTS}.${Permissions.CREATE}`]: false,
    [`permissions.${PermissionTypes.SKILLS}.${Permissions.CREATE}`]: false,
    [`permissions.${PermissionTypes.SKILLS}.${Permissions.SHARE}`]: false,
    [`permissions.${PermissionTypes.SHARED_LINKS}.${Permissions.CREATE}`]: false,
    [`permissions.${PermissionTypes.SHARED_LINKS}.${Permissions.SHARE}`]: false,
    [`permissions.${PermissionTypes.SHARED_LINKS}.${Permissions.SHARE_PUBLIC}`]: false,
  };
  await Role.findOneAndUpdate(
    { name: SystemRoles.USER },
    { $set: userRoleUpdates },
  );
  console.log('✓ USER role restricted (CREATE disabled for AGENTS, PROMPTS, MCP, etc.)');

  // Create test USER account
  console.log('Creating test USER account...');
  const existingTestUser = await db.findUser({ email: TEST_USER_EMAIL });
  if (existingTestUser) {
    console.log(`✓ Test user already exists: ${existingTestUser.email}`);
  } else {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(TEST_USER_PASSWORD, salt);
    const testUser = await db.createUser({
      email: TEST_USER_EMAIL,
      name: 'Test User',
      username: 'tester',
      password: hashedPassword,
      role: SystemRoles.USER,
      emailVerified: true,
    });
    console.log(`✓ Created test USER account:`);
    console.log(`    Email: ${testUser.email}`);
    console.log(`    Password: ${TEST_USER_PASSWORD}`);
    console.log(`    Role: ${testUser.role}`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('✓ Setup complete!');
  console.log('='.repeat(60));
  console.log('\nPrimary Agent:');
  console.log('  id: ' + agent.id);
  console.log('  name: ' + agent.name);
  console.log('  provider: ' + agent.provider);
  console.log('  model: ' + agent.model);
  console.log('  tools: ' + JSON.stringify(agent.tools));
  console.log('\nTest USER account:');
  console.log('  Email: ' + TEST_USER_EMAIL);
  console.log('  Password: ' + TEST_USER_PASSWORD);
  console.log('\nNext steps:');
  console.log('  1. Login as admin: ' + ADMIN_EMAIL);
  console.log('  2. Test as user: ' + TEST_USER_EMAIL);
  console.log('  3. USER should only see Ai Norx agent, no Agent Builder, no endpoints menu');

  await mongoose.disconnect();
  process.exit(0);
}

setupPrimaryAgent().catch((err) => {
  console.error('✗ Failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
