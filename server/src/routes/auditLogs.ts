import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/authMiddleware.ts';

const router = Router();

// GET /audit-logs - List audit logs with pagination, search, filters
router.get('/', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query?.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit ?? 50)));
    const skip = (page - 1) * limit;
    const search = String(req.query?.search ?? '').trim();
    const action = req.query?.action ? String(req.query.action) : undefined;
    const entity = req.query?.entity ? String(req.query.entity) : undefined;
    const actorUserId = req.query?.actorUserId ? String(req.query.actorUserId) : undefined;
    const startDate = req.query?.startDate ? String(req.query.startDate) : undefined;
    const endDate = req.query?.endDate ? String(req.query.endDate) : undefined;

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { action: { contains: search } },
        { entity: { contains: search } },
        { details: { contains: search } },
        { entityId: { contains: search } },
      ];
    }
    if (action) where.action = action;
    if (entity) where.entity = entity;
    if (actorUserId) where.actorUserId = actorUserId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Record<string, unknown>).gte = new Date(startDate);
      if (endDate) (where.createdAt as Record<string, unknown>).lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          actorUser: { select: { id: true, email: true, name: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      ok: true,
      items,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error) {
    console.error('[audit-logs] GET error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch audit logs' } });
  }
});

// GET /audit-logs/:id - Get single audit log detail
router.get('/:id', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const log = await prisma.auditLog.findUnique({
      where: { id },
      include: { actorUser: { select: { id: true, email: true, name: true } } },
    });
    if (!log) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Audit log not found' } });
    }
    res.json({ ok: true, item: log });
  } catch (error) {
    console.error('[audit-logs] GET detail error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch audit log' } });
  }
});

export default router;