/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { accessToken, refreshToken, user }
 *
 * Rate limited: 5 attempts per minute per IP (brute force protection).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../db/client';
import { users, userRoles, roles } from '../../../../db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '../../../../utils/crypto';
import { createJWTService } from '../../../../auth/jwt';
import { checkAuthRateLimit } from '../../../../lib/rate-limit';

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         req.headers.get('x-real-ip') ||
         'unknown';
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(1000, 'Password too long'),
});

export async function POST(req: NextRequest) {
  // ── Rate limit: 5 attempts per minute per IP ──────────────────────────
  const ip = getClientIp(req);
  const rl = checkAuthRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: { code: 'RATE_LIMITED', message: `Too many login attempts. Try again in ${rl.retryAfterSec}s.` } },
      {
        status: 429,
        headers: {
          'Retry-After': String(rl.retryAfterSec),
          'X-RateLimit-Limit': '5',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(rl.resetAtMs / 1000)),
        },
      }
    );
  }

  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;

    // Find user
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user || user.status !== 'active') {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } },
        { status: 401 }
      );
    }

    // Verify password
    if (!verifyPassword(password, user.passwordHash)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } },
        { status: 401 }
      );
    }

    // Get user roles
    const roleRows = await db
      .select({ role: roles })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, user.id));

    const userRolesList = roleRows.map(r => r.role.name);

    // Issue tokens
    const jwtService = createJWTService();
    const tokens = await jwtService.issueTokens({
      id: user.id,
      email: user.email,
      name: user.name || undefined,
      roles: userRolesList as any,
      status: user.status as any,
    }, {
      userAgent: req.headers.get('user-agent') || undefined,
      ip: req.headers.get('x-forwarded-for') || undefined,
    });

    // Update last login
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: userRolesList,
        },
        ...tokens,
      },
    });
  } catch (err: any) {
    console.error('[auth/login] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Login failed' } },
      { status: 500 }
    );
  }
}
