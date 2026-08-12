import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';

const router = Router();

// GET /orders - List orders with filters
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query?.page ?? 1));
    const limit = Math.min(200, Math.max(10, Number(req.query?.limit ?? 50)));
    const skip = (page - 1) * limit;
    const search = String(req.query?.search ?? '').trim();
    const status = req.query?.status ? String(req.query.status) : null;
    const channel = req.query?.channel ? String(req.query.channel) : null;
    const sortBy = String(req.query?.sortBy ?? 'createdAt');
    const sortOrder = String(req.query?.sortOrder ?? 'desc');

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { orderNo: { contains: search } },
        { customerName: { contains: search } },
        { customerPhone: { contains: search } },
      ];
    }
    if (status) where.status = status;
    if (channel) where.channel = channel;

    const orderBy: Record<string, string> = {};
    const validSort = ['createdAt', 'updatedAt', 'total', 'status', 'orderNo'];
    orderBy[validSort.includes(sortBy) ? sortBy : 'createdAt'] = sortOrder === 'asc' ? 'asc' : 'desc';

    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where: where as never,
        orderBy: orderBy as never,
        skip,
        take: limit,
        select: {
          id: true, orderNo: true, channel: true, customerName: true,
          customerEmail: true, customerPhone: true, status: true,
          total: true, createdAt: true, updatedAt: true,
          marketplace: { select: { id: true, name: true, key: true } },
        },
      }),
      prisma.order.count({ where: where as never }),
    ]);

    res.json({
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch orders' } });
  }
});

// GET /orders/stats - Order status counts
router.get('/stats', requireAuth, async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.order.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status] = row._count._all;
    }
    const total = await prisma.order.count();
    res.json({ counts, total });
  } catch (error) {
    console.error('Error fetching order stats:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch order stats' } });
  }
});

// GET /orders/:id - Order detail
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? '');
    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true, orderNo: true, channel: true, customerName: true,
        customerEmail: true, customerPhone: true, status: true,
        total: true, createdAt: true, updatedAt: true,
        marketplace: { select: { id: true, name: true, key: true } },
      },
    });
    if (!order) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sipariş bulunamadı' } });
    }
    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch order' } });
  }
});

// PUT /orders/:id - Update order status
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? '');
    const status = req.body?.status;
    if (!status) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'status zorunludur' } });
    }
    const validStatuses = ['new', 'approved', 'preparing', 'packing', 'invoiced', 'shipped', 'delivering', 'delivered', 'cancelled', 'returned', 'problem', 'archived'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz durum: ' + status } });
    }
    const order = await prisma.order.update({
      where: { id },
      data: { status },
      select: { id: true, orderNo: true, status: true },
    });
    res.json({ ok: true, order });
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update order' } });
  }
});

export default router;
