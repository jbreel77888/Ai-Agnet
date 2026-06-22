/**
 * GET /api/audit — Audit logs with pagination (admin only)
 *
 * Query params:
 *   page          — page number (default: 1)
 *   pageSize      — items per page (default: 50, max: 200)
 *   userId        — filter by user id
 *   action        — filter by action (case-insensitive LIKE)
 *   resourceType  — filter by resource type
 *   resourceId    — filter by resource id
 *   from          — ISO date (created_at >= from)
 *   to            — ISO date (created_at <= to)
 *
 * Returns:
 *   {
 *     logs: AuditLog[],
 *     pagination: { page, pageSize, total, totalPages }
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../db/client';
import { auditLogs, users } from '../../../db/schema';
import { eq, desc, and, gte, lte, ilike, count } from 'drizzle-orm';
import { createJWTService } from '../../../auth/jwt';

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

export async function GET(req: NextRequest) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  try {
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '50', 10) || 50));
    const userId = url.searchParams.get('userId');
    const action = url.searchParams.get('action');
    const resourceType = url.searchParams.get('resourceType');
    const resourceId = url.searchParams.get('resourceId');
    const fromStr = url.searchParams.get('from');
    const toStr = url.searchParams.get('to');

    const conditions = [];
    if (userId) conditions.push(eq(auditLogs.userId, userId));
    if (action) conditions.push(ilike(auditLogs.action, `%${action}%`));
    if (resourceType) conditions.push(eq(auditLogs.resourceType, resourceType));
    if (resourceId) conditions.push(eq(auditLogs.resourceId, resourceId));
    if (fromStr) {
      const from = new Date(fromStr);
      if (!isNaN(from.getTime())) conditions.push(gte(auditLogs.createdAt, from));
    }
    if (toStr) {
      const to = new Date(toStr);
      if (!isNaN(to.getTime())) conditions.push(lte(auditLogs.createdAt, to));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Total count
    const [totalRow] = whereClause
      ? await db.select({ total: count() }).from(auditLogs).where(whereClause)
      : await db.select({ total: count() }).from(auditLogs);
    const total = Number(totalRow?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // Fetch page joined with user email
    const baseQuery = db
      .select({
        log: auditLogs,
        userEmail: users.email,
        userName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id));

    const rows = whereClause
      ? await baseQuery
          .where(whereClause)
          .orderBy(desc(auditLogs.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize)
      : await baseQuery
          .orderBy(desc(auditLogs.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize);

    const serialized = rows.map((r) => ({
      id: r.log.id,
      userId: r.log.userId,
      userEmail: r.userEmail ?? null,
      userName: r.userName ?? null,
      action: r.log.action,
      resourceType: r.log.resourceType,
      resourceId: r.log.resourceId,
      before: r.log.before,
      after: r.log.after,
      ipAddress: r.log.ipAddress,
      userAgent: r.log.userAgent,
      createdAt: r.log.createdAt,
    }));

    return NextResponse.json({
      success: true,
      data: {
        logs: serialized,
        pagination: { page, pageSize, total, totalPages },
      },
    });
  } catch (err: any) {
    console.error('[audit/list] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch audit logs' } },
      { status: 500 }
    );
  }
}
