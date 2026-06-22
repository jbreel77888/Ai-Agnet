/**
 * GET /api/auth/me — Get current user
 * PATCH /api/auth/me — Update current user (name, avatar)
 * POST /api/auth/change-password — Change password (same route, different action)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../db/client';
import { users, userRoles, roles } from '../../../../db/schema';
import { eq } from 'drizzle-orm';
import { createJWTService } from '../../../../auth/jwt';
import { verifyPassword, hashPassword } from '../../../../utils/crypto';
import { z } from 'zod';

async function getCurrentUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const jwtService = createJWTService();
  try {
    const payload = await jwtService.verifyAccessToken(token);
    const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!user || user.status !== 'active') return null;

    const roleRows = await db
      .select({ role: roles })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, user.id));

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      roles: roleRows.map(r => r.role.name),
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  return NextResponse.json({ success: true, data: { user } });
}

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
});

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  try {
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } },
        { status: 400 }
      );
    }

    const updates: any = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.avatarUrl !== undefined) updates.avatarUrl = parsed.data.avatarUrl;
    updates.updatedAt = new Date();

    const [updated] = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: updated.id,
          email: updated.email,
          name: updated.name,
          avatarUrl: updated.avatarUrl,
          roles: user.roles,
          status: updated.status,
        },
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: { code: 'UPDATE_FAILED', message: 'Update failed' } },
      { status: 500 }
    );
  }
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  try {
    const body = await req.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } },
        { status: 400 }
      );
    }

    // Get current password hash
    const [userRow] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!userRow) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
        { status: 404 }
      );
    }

    // Verify current password
    if (!verifyPassword(parsed.data.currentPassword, userRow.passwordHash)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' } },
        { status: 401 }
      );
    }

    // Update password
    const newHash = hashPassword(parsed.data.newPassword);
    await db.update(users).set({
      passwordHash: newHash,
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));

    // Revoke all existing tokens (force re-login)
    const jwtService = createJWTService();
    await jwtService.revokeAllUserTokens(user.id);

    return NextResponse.json({
      success: true,
      data: { message: 'Password changed. Please log in again.' },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: { code: 'CHANGE_FAILED', message: 'Password change failed' } },
      { status: 500 }
    );
  }
}
