/**
 * Seed script — creates initial data:
 * - Default roles (admin, operator, user)
 * - Default permissions
 * - Default admin user
 *
 * Run: bun run scripts/seed.ts
 */

import { db } from '../src/db/client';
import {
  users, roles, permissions, rolePermissions, userRoles,
} from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../src/utils/crypto';

const DEFAULT_ADMIN = {
  email: 'admin@agent-platform.local',
  password: 'admin123', // Change this in production!
  name: 'System Admin',
};

const DEFAULT_ROLES = [
  { name: 'admin', description: 'Full system access', isSystem: true },
  { name: 'operator', description: 'Manage agents, tools, sessions', isSystem: true },
  { name: 'user', description: 'Use the platform only', isSystem: true },
];

const DEFAULT_PERMISSIONS = [
  // Providers
  { name: 'providers:read', resource: 'providers', action: 'read', description: 'View providers' },
  { name: 'providers:write', resource: 'providers', action: 'write', description: 'Create/update providers' },
  { name: 'providers:delete', resource: 'providers', action: 'delete', description: 'Delete providers' },
  // Models
  { name: 'models:read', resource: 'models', action: 'read', description: 'View models' },
  { name: 'models:write', resource: 'models', action: 'write', description: 'Create/update models' },
  // Agents
  { name: 'agents:read', resource: 'agents', action: 'read', description: 'View agents' },
  { name: 'agents:write', resource: 'agents', action: 'write', description: 'Create/update agents' },
  { name: 'agents:delete', resource: 'agents', action: 'delete', description: 'Delete agents' },
  // Tools
  { name: 'tools:read', resource: 'tools', action: 'read', description: 'View tools' },
  { name: 'tools:write', resource: 'tools', action: 'write', description: 'Create/update tools' },
  { name: 'tools:execute', resource: 'tools', action: 'execute', description: 'Execute tools' },
  // MCP
  { name: 'mcp:read', resource: 'mcp', action: 'read', description: 'View MCP servers' },
  { name: 'mcp:write', resource: 'mcp', action: 'write', description: 'Manage MCP servers' },
  // Sessions
  { name: 'sessions:read', resource: 'sessions', action: 'read', description: 'View sessions' },
  { name: 'sessions:write', resource: 'sessions', action: 'write', description: 'Create sessions' },
  // Memory
  { name: 'memory:read', resource: 'memory', action: 'read', description: 'View memory' },
  { name: 'memory:write', resource: 'memory', action: 'write', description: 'Store memory' },
  // Workflows
  { name: 'workflows:read', resource: 'workflows', action: 'read', description: 'View workflows' },
  { name: 'workflows:write', resource: 'workflows', action: 'write', description: 'Manage workflows' },
  { name: 'workflows:execute', resource: 'workflows', action: 'execute', description: 'Run workflows' },
  // Users & RBAC
  { name: 'users:read', resource: 'users', action: 'read', description: 'View users' },
  { name: 'users:write', resource: 'users', action: 'write', description: 'Manage users' },
  { name: 'roles:read', resource: 'roles', action: 'read', description: 'View roles' },
  { name: 'roles:write', resource: 'roles', action: 'write', description: 'Manage roles' },
  // Observability
  { name: 'logs:read', resource: 'logs', action: 'read', description: 'View logs' },
  { name: 'traces:read', resource: 'traces', action: 'read', description: 'View traces' },
  { name: 'audit:read', resource: 'audit', action: 'read', description: 'View audit logs' },
  { name: 'costs:read', resource: 'costs', action: 'read', description: 'View cost reports' },
  { name: 'costs:write', resource: 'costs', action: 'write', description: 'Manage budgets' },
];

async function seed() {
  console.log('='.repeat(60));
  console.log('Seeding initial data...');
  console.log('='.repeat(60));

  // 1. Create roles
  console.log('\n1. Creating roles...');
  for (const role of DEFAULT_ROLES) {
    const [existing] = await db.select().from(roles).where(eq(roles.name, role.name)).limit(1);
    if (existing) {
      console.log(`  ✓ Role "${role.name}" already exists`);
      continue;
    }
    await db.insert(roles).values(role);
    console.log(`  ✓ Created role: ${role.name}`);
  }

  // 2. Create permissions
  console.log('\n2. Creating permissions...');
  for (const perm of DEFAULT_PERMISSIONS) {
    const [existing] = await db.select().from(permissions).where(eq(permissions.name, perm.name)).limit(1);
    if (existing) continue;
    await db.insert(permissions).values(perm);
  }
  console.log(`  ✓ ${DEFAULT_PERMISSIONS.length} permissions ready`);

  // 3. Assign all permissions to admin role
  console.log('\n3. Assigning permissions to admin role...');
  const [adminRole] = await db.select().from(roles).where(eq(roles.name, 'admin')).limit(1);
  if (adminRole) {
    const allPerms = await db.select().from(permissions);
    for (const perm of allPerms) {
      await db.insert(rolePermissions).values({
        roleId: adminRole.id,
        permissionId: perm.id,
      }).onConflictDoNothing();
    }
    console.log(`  ✓ Admin role has ${allPerms.length} permissions`);
  }

  // 4. Assign limited permissions to operator role
  console.log('\n4. Assigning permissions to operator role...');
  const [operatorRole] = await db.select().from(roles).where(eq(roles.name, 'operator')).limit(1);
  if (operatorRole) {
    const operatorPerms = [
      'agents:read', 'agents:write',
      'tools:read', 'tools:execute',
      'mcp:read', 'mcp:write',
      'sessions:read', 'sessions:write',
      'memory:read', 'memory:write',
      'workflows:read', 'workflows:write', 'workflows:execute',
      'models:read',
      'providers:read',
      'logs:read', 'traces:read', 'costs:read',
    ];
    for (const permName of operatorPerms) {
      const [perm] = await db.select().from(permissions).where(eq(permissions.name, permName)).limit(1);
      if (perm) {
        await db.insert(rolePermissions).values({
          roleId: operatorRole.id,
          permissionId: perm.id,
        }).onConflictDoNothing();
      }
    }
    console.log(`  ✓ Operator role has ${operatorPerms.length} permissions`);
  }

  // 5. Assign basic permissions to user role
  console.log('\n5. Assigning permissions to user role...');
  const [userRole] = await db.select().from(roles).where(eq(roles.name, 'user')).limit(1);
  if (userRole) {
    const userPerms = [
      'sessions:read', 'sessions:write',
      'memory:read', 'memory:write',
      'agents:read',
      'tools:read',
      'workflows:execute',
      'costs:read',
    ];
    for (const permName of userPerms) {
      const [perm] = await db.select().from(permissions).where(eq(permissions.name, permName)).limit(1);
      if (perm) {
        await db.insert(rolePermissions).values({
          roleId: userRole.id,
          permissionId: perm.id,
        }).onConflictDoNothing();
      }
    }
    console.log(`  ✓ User role has ${userPerms.length} permissions`);
  }

  // 6. Create default admin user
  console.log('\n6. Creating default admin user...');
  const [existingAdmin] = await db.select().from(users).where(eq(users.email, DEFAULT_ADMIN.email)).limit(1);
  if (existingAdmin) {
    console.log(`  ✓ Admin user already exists (${DEFAULT_ADMIN.email})`);
  } else {
    const passwordHash = hashPassword(DEFAULT_ADMIN.password);
    const [adminUser] = await db.insert(users).values({
      email: DEFAULT_ADMIN.email,
      passwordHash,
      name: DEFAULT_ADMIN.name,
      status: 'active',
    }).returning();

    if (adminRole && adminUser) {
      await db.insert(userRoles).values({
        userId: adminUser.id,
        roleId: adminRole.id,
      }).onConflictDoNothing();
    }
    console.log(`  ✓ Created admin user:`);
    console.log(`    Email: ${DEFAULT_ADMIN.email}`);
    console.log(`    Password: ${DEFAULT_ADMIN.password}`);
    console.log(`    ⚠️  Change this password after first login!`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✓ Seed completed successfully');
  console.log('='.repeat(60));

  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
