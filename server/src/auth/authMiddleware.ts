import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env.ts';

export type AuthedRequest = Request & {
  actor?: {
    userId: string;
    role: string;
  };
};

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
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

    req.actor = {
      userId: String(decoded.sub),
      role: String(decoded.role ?? 'OPERATOR'),
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
