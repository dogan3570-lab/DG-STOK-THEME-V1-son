import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/authMiddleware.ts';

const router = Router();

// GET /notifications - List notifications with pagination, filters
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query?.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit ?? 50)));
    const skip = (page - 1) * limit;
    const search = String(req.query?.search ?? '').trim();
    const read = req.query?.read ? String(req.query.read) === 'true' : undefined;
    const type = req.query?.type ? String(req.query.type) : undefined;

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { message: { contains: search } },
      ];
    }
    if (read !== undefined) where.read = read;
    if (type) where.type = type;

    const [items, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          read: true,
          createdAt: true,
        },
      }),
      prisma.notification.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    res.json({
      ok: true,
      items,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error) {
    console.error('[notifications] GET error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch notifications' } });
  }
});

// PUT /notifications/:id/read - mark as read
router.put('/:id/read', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notification not found' } });
    }
    if (notification.read) {
      return res.json({ ok: true, message: 'Already read' });
    }
    await prisma.notification.update({
      where: { id },
      data: { read: true },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error marking notification read:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to mark as read' } });
  }
});

export default router;