import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env.ts';
import { prisma } from '../db/prisma.ts';

export type AuthedRequest = Request & {
  actor?: {
    userId: string;
    role: string;
  };
};

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  let token = req.cookies?.token;

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    token = (req.headers['x-auth-token'] as string) || (req.headers['x-token'] as string);
  }

  if (!token) {
    return res.status(401).json({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
    });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload & { sub?: string; role?: string };
    if (!decoded?.sub) {
      return res.status(401).json({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: String(decoded.sub) },
      select: { id: true, role: true, preferences: true },
    });

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
      });
    }

    let mustChangePassword = false;
    try {
      const prefs = JSON.parse(user.preferences || '{}');
      mustChangePassword = !!prefs.mustChangePassword;
    } catch {
      /* bozuk preferences parola zorunluluğunu atlamaz */
    }

    if (mustChangePassword) {
      return res.status(403).json({
        ok: false,
        error: { code: 'MUST_CHANGE_PASSWORD', message: 'Password change required' },
      });
    }

    req.actor = {
      userId: user.id,
      role: user.role,
    };

    next();
  } catch {
    return res.status(401).json({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
    });
  }
}

export function requireRole(allowedRoles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const role = req.actor?.role;
    if (!role) {
      return res.status(401).json({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
      });
    }
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'forbidden' },
      });
    }
    next();
  };
}
