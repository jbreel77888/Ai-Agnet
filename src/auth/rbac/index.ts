/**
 * RBAC — Role-Based Access Control
 */
import { db } from '../../db/client';
import { roles, permissions, rolePermissions, userRoles } from '../../db/schema/auth.schema';
import { eq } from 'drizzle-orm';
import type { SystemRole } from '../../types';

export interface RBACService {
  hasRole(userId: string, role: SystemRole | SystemRole[]): Promise<boolean>;
  hasPermission(userId: string, resource: string, action: string): Promise<boolean>;
  getUserRoles(userId: string): Promise<SystemRole[]>;
  getUserPermissions(userId: string): Promise<Set<string>>;
  assignRole(userId: string, role: SystemRole): Promise<void>;
  revokeRole(userId: string, role: SystemRole): Promise<void>;
}

const PERMISSION_CACHE_TTL_MS = 60_000; // 1 minute
const cache = new Map<string, { value: Set<string>; expiresAt: number }>();

export function createRBACService(): RBACService {
  const getUserRoles = async (userId: string): Promise<SystemRole[]> => {
    const roleRows = await db
      .select({ role: roles })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));
    return roleRows.map(r => r.role.name as SystemRole);
  };

  const getUserPermissions = async (userId: string): Promise<Set<string>> => {
    const cacheKey = `perms:${userId}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const permRows = await db
      .select({ permission: permissions })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(userRoles.userId, userId));

    const set = new Set(permRows.map(p => `${p.permission.resource}:${p.permission.action}`));
    cache.set(cacheKey, { value: set, expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS });
    return set;
  };

  const hasRole = async (userId: string, role: SystemRole | SystemRole[]): Promise<boolean> => {
    const userRolesList = await getUserRoles(userId);
    if (Array.isArray(role)) {
      return role.some(r => userRolesList.includes(r));
    }
    return userRolesList.includes(role);
  };

  const hasPermission = async (userId: string, resource: string, action: string): Promise<boolean> => {
    // Admin bypasses
    const userRolesList = await getUserRoles(userId);
    if (userRolesList.includes('admin')) return true;

    const perms = await getUserPermissions(userId);
    return perms.has(`${resource}:${action}`) || perms.has(`${resource}:*`);
  };

  const assignRole = async (userId: string, role: SystemRole): Promise<void> => {
    const [roleRecord] = await db.select().from(roles).where(eq(roles.name, role)).limit(1);
    if (!roleRecord) throw new Error(`Role ${role} not found`);

    await db.insert(userRoles).values({
      userId,
      roleId: roleRecord.id,
    }).onConflictDoNothing();

    cache.delete(`perms:${userId}`);
  };

  const revokeRole = async (userId: string, role: SystemRole): Promise<void> => {
    const [roleRecord] = await db.select().from(roles).where(eq(roles.name, role)).limit(1);
    if (!roleRecord) return;

    await db.delete(userRoles)
      .where(eq(userRoles.userId, userId) && eq(userRoles.roleId, roleRecord.id) as any);

    cache.delete(`perms:${userId}`);
  };

  return {
    hasRole,
    hasPermission,
    getUserRoles,
    getUserPermissions,
    assignRole,
    revokeRole,
  };
}
