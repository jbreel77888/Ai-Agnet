/**
 * /api/users/[id]
 * GET    — Get user details (admin only)
 * PATCH  — Update user (admin only)
 * DELETE — Delete user (admin only; soft-delete by setting status='deleted')
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../db/client';
import { users, roles, userRoles } from '../../../../db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../../../../utils/crypto';
import { createJWTService } from '../../../../auth/jwt';
import { createAuditLogger } from '../../../../observability/logger/audit';

async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const jwtService = createJWTService();
    const payload = await jwtService.verifyAccessToken(authHeader.slice(7));
    if (!payload.roles?.includes('admin')) return null;
    return payload;
  } catch {
    return null;
  }
}

function sanitizeUser(u: any, roleList: string[] = []) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    status: u.status,
    roles: roleList,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

async function fetchUserWithRoles(id: string) {
  const rows = await db
    .select({ user: users, role: roles })
    .from(users)
    .leftJoin(userRoles, eq(users.id, userRoles.userId))
    .leftJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(users.id, id));

  if (rows.length === 0) return null;
  const roleNames = rows.map((r) => r.role?.name).filter(Boolean) as string[];
  return { user: rows[0].user, roles: roleNames };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const adminUser = await requireAdmin(req);
  if (!adminUser) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  const { id } = await params;
  const result = await fetchUserWithRoles(id);
  if (!result) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: { user: sanitizeUser(result.user, result.roles) } });
}

const updateSchema = z.object({
  email: z.string().email().max(255).optional(),
  name: z.string().min(1).max(100).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  password: z.string().min(8).max(128).optional(),
  roles: z.array(z.string().min(1).max(50)).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const adminUser = await requireAdmin(req);
  if (!adminUser) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } },
        { status: 400 }
      );
    }

    const before = await fetchUserWithRoles(id);
    if (!before) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
        { status: 404 }
      );
    }

    const { email, name, avatarUrl, status, password, roles: roleNames } = parsed.data;
    const updates: any = { updatedAt: new Date() };
    if (email !== undefined) updates.email = email.toLowerCase();
    if (name !== undefined) updates.name = name;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
    if (status !== undefined) updates.status = status;
    if (password !== undefined) updates.passwordHash = hashPassword(password);

    const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning();

    // Reconcile roles if provided
    let finalRoles = before.roles;
    if (roleNames !== undefined) {
      await db.delete(userRoles).where(eq(userRoles.userId, id));
      if (roleNames.length > 0) {
        const roleRows = await db.select().from(roles);
        const roleMap = new Map(roleRows.map((r) => [r.name, r.id]));
        const assignments: { userId: string; roleId: string }[] = [];
        for (const rn of roleNames) {
          const rid = roleMap.get(rn);
          if (rid) assignments.push({ userId: id, roleId: rid });
        }
        if (assignments.length > 0) {
          await db.insert(userRoles).values(assignments);
        }
        finalRoles = roleNames;
      } else {
        finalRoles = [];
      }
    }

    const audit = createAuditLogger();
    await audit.record({
      userId: adminUser.sub,
      action: 'user.update',
      resourceType: 'user',
      resourceId: id,
      before: sanitizeUser(before.user, before.roles),
      after: sanitizeUser(updated, finalRoles),
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ success: true, data: { user: sanitizeUser(updated, finalRoles) } });
  } catch (err: any) {
    console.error('[users/update] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Update failed' } },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const adminUser = await requireAdmin(req);
  if (!adminUser) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    const before = await fetchUserWithRoles(id);
    if (!before) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
        { status: 404 }
      );
    }

    // Prevent self-deletion
    if (id === adminUser.sub) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Cannot delete your own account' } },
        { status: 400 }
      );
    }

    // Soft-delete: mark as deleted, keep the row for audit trail
    const [updated] = await db
      .update(users)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();

    const audit = createAuditLogger();
    await audit.record({
      userId: adminUser.sub,
      action: 'user.delete',
      resourceType: 'user',
      resourceId: id,
      before: sanitizeUser(before.user, before.roles),
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      success: true,
      data: { message: 'User deleted', user: sanitizeUser(updated, before.roles) },
    });
  } catch (err: any) {
    console.error('[users/delete] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Delete failed' } },
      { status: 500 }
    );
  }
}
