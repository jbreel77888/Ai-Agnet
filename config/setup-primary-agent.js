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
تعمل في بيئة Linux sandbox مع اتصال بالإنترنت.

# المهام التي تتفوق فيها
1. جمع المعلومات والتحقق من الحقائق والتوثيق
2. معالجة وتحليل البيانات وتصويرها
3. كتابة المقالات المتعددة الفصول والتقارير المعمقة
4. إنشاء المواقع والتطبيقات والأدوات
5. استخدام البرمجة لحل المشاكل المختلفة
6. المهام المختلفة التي يمكن إنجازها بالحاسوب والإنترنت

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

# القواعد
- يجب دائماً استخدام أداة (function call)؛ الردود النصية الخالصة ممنوعة
- لا تذكر أسماء الأدوات للمستخدم في الرسائل
- احفظ الكود في ملفات قبل التنفيذ
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
    'tavily_search_results_json',
    'calculator',
  ],
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

  if (agent) {
    agent = await db.updateAgent({ id: PRIMARY_AGENT_ID }, agentData);
    console.log(`✓ Updated existing primary-agent: ${agent._id}`);
  } else {
    agent = await db.createAgent(agentData);
    console.log(`✓ Created new primary-agent: ${agent._id}`);
  }

  // Grant ACL permissions
  console.log('Setting ACL permissions...');
  const adminRole = await db.getRoleByName(SystemRoles.ADMIN);
  const userRole = await db.getRoleByName(SystemRoles.USER);

  if (adminRole && userRole) {
    // Permission bits: 1=USE, 2=CREATE/EDIT, 4=UPDATE, 8=DELETE, 16=SHARE
    // ADMIN — full access (all bits)
    try {
      await db.grantPermission(
        PrincipalType.ROLE,
        adminRole._id,
        ResourceType.AGENT,
        agent._id,
        31, // USE+EDIT+UPDATE+DELETE+SHARE
        adminUser._id,
        null,
        adminRole._id,
      );
      console.log('  ✓ ADMIN role: full access (all permission bits)');
    } catch (err) {
      console.error('  ✗ ADMIN grant failed:', err.message);
    }

    // USER — USE only (bit 1)
    try {
      await db.grantPermission(
        PrincipalType.ROLE,
        userRole._id,
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
