/**
 * POST /api/auth/refresh
 * Body: { refreshToken }
 * Returns: { accessToken, refreshToken, expiresAt }
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createJWTService } from '../../../../auth/jwt';

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = refreshSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'refreshToken required' } },
        { status: 400 }
      );
    }

    const jwtService = createJWTService();
    const tokens = await jwtService.refreshTokens(parsed.data.refreshToken);

    return NextResponse.json({
      success: true,
      data: tokens,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: { code: 'REFRESH_FAILED', message: err.message || 'Invalid refresh token' } },
      { status: 401 }
    );
  }
}
