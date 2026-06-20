/**
 * JWT Service — Access + Refresh tokens
 */
import jwt from 'jsonwebtoken';
import { hashToken, generateToken } from '../../utils/crypto';
import { db } from '../../db/client';
import { refreshTokens, users, userRoles, roles } from '../../db/schema/auth.schema';
import { eq, lt } from 'drizzle-orm';
import type { AuthUser } from '../../types';

export interface JWTService {
  issueTokens(user: AuthUser, deviceInfo?: Record<string, unknown>): Promise<TokenPair>;
  verifyAccessToken(token: string): Promise<TokenPayload>;
  refreshTokens(refreshToken: string): Promise<TokenPair>;
  revokeRefreshToken(token: string): Promise<void>;
  revokeAllUserTokens(userId: string): Promise<void>;
  cleanupExpired(): Promise<number>;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface TokenPayload {
  sub: string;          // user id
  email: string;
  roles: string[];
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

const ACCESS_TYPE = 'access';
const REFRESH_TYPE = 'refresh';

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[jwt] JWT_SECRET is required in production');
    }
    console.warn('[jwt] JWT_SECRET not set — using dev secret. DO NOT use in production!');
    return 'dev-only-secret-not-for-production-use-min-32-chars!!';
  }
  return secret;
}

export function createJWTService(): JWTService {
  const accessTtlMin = Number(process.env.JWT_ACCESS_TTL_MIN ?? 15);
  const refreshTtlDays = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7);
  const secret = getSecret();

  const sign = (payload: Omit<TokenPayload, 'iat' | 'exp'>, ttlSec: number): string => {
    return jwt.sign(payload, secret, { expiresIn: ttlSec });
  };

  const issueTokens = async (user: AuthUser, deviceInfo?: Record<string, unknown>): Promise<TokenPair> => {
    // Access token
    const accessPayload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
      type: ACCESS_TYPE,
    };
    const accessToken = sign(accessPayload, accessTtlMin * 60);

    // Refresh token (random, hashed in DB)
    const refreshToken = generateToken(48);
    const refreshTokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);

    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: refreshTokenHash,
      expiresAt,
      deviceInfo: deviceInfo as any,
    });

    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + accessTtlMin * 60 * 1000),
    };
  };

  const verifyAccessToken = async (token: string): Promise<TokenPayload> => {
    const decoded = jwt.verify(token, secret) as TokenPayload;
    if (decoded.type !== ACCESS_TYPE) {
      throw new Error('Expected access token, got refresh token');
    }
    return decoded;
  };

  const refreshTokensFn = async (refreshToken: string): Promise<TokenPair> => {
    const tokenHash = hashToken(refreshToken);
    const [record] = await db.select().from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!record) throw new Error('Invalid refresh token');
    if (record.revokedAt) throw new Error('Refresh token revoked');
    if (record.expiresAt < new Date()) throw new Error('Refresh token expired');

    // Revoke the old token (rotation)
    await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, record.id));

    // Build minimal user from DB (already imported at top)
    const [user] = await db.select().from(users).where(eq(users.id, record.userId)).limit(1);
    if (!user || user.status !== 'active') throw new Error('User not found or inactive');

    const userRoleRows = await db
      .select({ role: roles })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, user.id));
    const userRolesList = userRoleRows.map(r => r.role.name) as any;

    return issueTokens({
      id: user.id,
      email: user.email,
      name: user.name ?? undefined,
      roles: userRolesList,
      status: user.status as any,
    }, record.deviceInfo as any);
  };

  const revokeRefreshToken = async (token: string): Promise<void> => {
    const tokenHash = hashToken(token);
    await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));
  };

  const revokeAllUserTokens = async (userId: string): Promise<void> => {
    await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, userId));
  };

  const cleanupExpired = async (): Promise<number> => {
    const result = await db.delete(refreshTokens)
      .where(lt(refreshTokens.expiresAt, new Date()));
    return (result as any)?.rowCount ?? 0;
  };

  return {
    issueTokens,
    verifyAccessToken,
    refreshTokens: refreshTokensFn,
    revokeRefreshToken,
    revokeAllUserTokens,
    cleanupExpired,
  };
}
