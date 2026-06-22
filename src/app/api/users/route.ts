/**
 * GET /api/users — List all users (admin only)
 * POST /api/users — Create a new user (admin only)
 *
 * Never returns password_hash.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../db/client';
import { users, roles, userRoles } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../../../utils/crypto';
import { createJWTService } from '../../../auth/jwt';
import { createAuditLogger } from '../../../observability/logger/audit';

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

export async function GET(req: NextRequest) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  try {
    // Fetch users with their roles via two left joins
    const rows = await db
      .select({ user: users, role: roles })
      .from(users)
      .leftJoin(userRoles, eq(users.id, userRoles.userId))
      .leftJoin(roles, eq(userRoles.roleId, roles.id))
      .orderBy(users.createdAt);

    // Group roles by user id
    const userMap = new Map<string, { user: any; roles: string[] }>();
    for (const row of rows) {
      const u = row.user;
      if (!userMap.has(u.id)) {
        userMap.set(u.id, { user: u, roles: [] });
      }
      if (row.role) {
        userMap.get(u.id)!.roles.push(row.role.name);
      }
    }

    const result = Array.from(userMap.values()).map(({ user: u, roles: rl }) =>
      sanitizeUser(u, rl)
    );

    return NextResponse.json({ success: true, data: { users: result, total: result.length } });
  } catch (err: any) {
    console.error('[users/list] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch users' } },
      { status: 500 }
    );
  }
}

const createUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
  roles: z.array(z.string().min(1).max(50)).default(['user']),
});

export async function POST(req: NextRequest) {
  const adminUser = await requireAdmin(req);
  if (!adminUser) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } },
        { status: 400 }
      );
    }

    const { email, password, name, avatarUrl, roles: roleNames } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    // Check for existing user
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    if (existing) {
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: 'Email already in use' } },
        { status: 409 }
      );
    }

    const passwordHash = hashPassword(password);

    const [created] = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        passwordHash,
        name: name ?? null,
        avatarUrl: avatarUrl ?? null,
        status: 'active',
      })
      .returning();

    // Assign roles — resolve role names to ids
    if (roleNames.length > 0) {
      const roleRows = await db.select().from(roles);
      const roleMap = new Map(roleRows.map((r) => [r.name, r.id]));
      const assignments: { userId: string; roleId: string }[] = [];
      for (const rn of roleNames) {
        const rid = roleMap.get(rn);
        if (rid) assignments.push({ userId: created.id, roleId: rid });
      }
      if (assignments.length > 0) {
        await db.insert(userRoles).values(assignments);
      }
    }

    const audit = createAuditLogger();
    await audit.record({
      userId: adminUser.sub,
      action: 'user.create',
      resourceType: 'user',
      resourceId: created.id,
      after: sanitizeUser(created, roleNames),
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json(
      { success: true, data: { user: sanitizeUser(created, roleNames) } },
      { status: 201 }
    );
  } catch (err: any) {
    console.error('[users/create] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create user' } },
      { status: 500 }
    );
  }
}
