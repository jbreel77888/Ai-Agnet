/**
 * POST /api/auth/register
 * Body: { email, password, name }
 * Returns: { user, accessToken, refreshToken }
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../db/client';
import { users, roles, userRoles } from '../../../../db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../../../../utils/crypto';
import { createJWTService } from '../../../../auth/jwt';

const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).max(100).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } },
        { status: 400 }
      );
    }

    const { email, password, name } = parsed.data;

    // Check if user already exists
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      return NextResponse.json(
        { success: false, error: { code: 'EMAIL_EXISTS', message: 'Email already registered' } },
        { status: 409 }
      );
    }

    // Create user
    const passwordHash = hashPassword(password);
    const [newUser] = await db.insert(users).values({
      email,
      passwordHash,
      name: name || null,
      status: 'active',
    }).returning();

    // Assign 'user' role by default
    const [userRole] = await db.select().from(roles).where(eq(roles.name, 'user')).limit(1);
    if (userRole) {
      await db.insert(userRoles).values({
        userId: newUser.id,
        roleId: userRole.id,
      }).onConflictDoNothing();
    }

    // Issue tokens
    const jwtService = createJWTService();
    const tokens = await jwtService.issueTokens({
      id: newUser.id,
      email: newUser.email,
      name: newUser.name || undefined,
      roles: ['user'],
      status: 'active',
    }, {
      userAgent: req.headers.get('user-agent') || undefined,
      ip: req.headers.get('x-forwarded-for') || undefined,
    });

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          roles: ['user'],
        },
        ...tokens,
      },
    }, { status: 201 });
  } catch (err: any) {
    console.error('[auth/register] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Registration failed' } },
      { status: 500 }
    );
  }
}
