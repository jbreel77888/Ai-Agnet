/**
 * POST /api/auth/logout
 * Body: { refreshToken }
 * Revokes the refresh token
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createJWTService } from '../../../../auth/jwt';

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = logoutSchema.safeParse(body);

    if (parsed.success) {
      const jwtService = createJWTService();
      await jwtService.revokeRefreshToken(parsed.data.refreshToken);
    }

    return NextResponse.json({
      success: true,
      data: { message: 'Logged out' },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: { code: 'LOGOUT_FAILED', message: 'Logout failed' } },
      { status: 500 }
    );
  }
}
