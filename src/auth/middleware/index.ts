/**
 * Auth Middleware — Next.js compatible
 * Extracts user from JWT, attaches to request
 */
import { NextRequest, NextResponse } from 'next/server';
import { createJWTService, type JWTService } from '../jwt';
import { createRBACService, type RBACService } from '../rbac';
import type { AuthUser, SystemRole } from '../../types';

let jwtService: JWTService | null = null;
let rbacService: RBACService | null = null;

function getServices() {
  if (!jwtService) jwtService = createJWTService();
  if (!rbacService) rbacService = createRBACService();
  return { jwtService, rbacService };
}

export interface AuthenticatedRequest extends NextRequest {
  user?: AuthUser;
}

export async function withAuth(
  handler: (req: AuthenticatedRequest, ctx: { params?: Record<string, string> }) => Promise<NextResponse> | NextResponse,
  opts?: { requiredRoles?: SystemRole[] }
) {
  return async (req: AuthenticatedRequest, ctx: { params?: Record<string, string> } = {}): Promise<NextResponse> => {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing auth token' } },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7);
    const { jwtService: jwt, rbacService: rbac } = getServices();

    try {
      const payload = await jwt.verifyAccessToken(token);
      req.user = {
        id: payload.sub,
        email: payload.email,
        roles: payload.roles as SystemRole[],
        status: 'active',
      };

      // Check roles
      if (opts?.requiredRoles && opts.requiredRoles.length > 0) {
        const hasRequired = opts.requiredRoles.some(r => req.user!.roles.includes(r));
        if (!hasRequired) {
          return NextResponse.json(
            { success: false, error: { code: 'FORBIDDEN', message: `Requires role: ${opts.requiredRoles.join(' or ')}` } },
            { status: 403 }
          );
        }
      }

      return handler(req, ctx);
    } catch (err: any) {
      return NextResponse.json(
        { success: false, error: { code: 'TOKEN_INVALID', message: err.message || 'Invalid token' } },
        { status: 401 }
      );
    }
  };
}

export async function requirePermission(
  userId: string,
  resource: string,
  action: string
): Promise<boolean> {
  const { rbacService: rbac } = getServices();
  return rbac.hasPermission(userId, resource, action);
}
