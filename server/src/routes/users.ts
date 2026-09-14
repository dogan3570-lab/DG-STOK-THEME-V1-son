import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/authMiddleware.ts';
import bcrypt from 'bcryptjs';

const router = Router();

// GET /users/customers - List all CUSTOMER role users
router.get('/customers', requireAuth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(_req.query?.page ?? 1));
    const limit = Math.min(200, Math.max(10, Number(_req.query?.limit ?? 50)));
    const skip = (page - 1) * limit;
    const search = String(_req.query?.search ?? '').trim();

    const where: Record<string, unknown> = {
      role: 'CUSTOMER',
    };

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          role: true,
          name: true,
          createdAt: true,
          preferences: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    const safeItems = items.map((user) => {
      let mustChangePassword = false;
      try {
        const prefs = JSON.parse(user.preferences || '{}');
        mustChangePassword = !!prefs.mustChangePassword;
      } catch { /* ignore */ }
      return {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        createdAt: user.createdAt,
        mustChangePassword,
      };
    });

    res.json({
      items: safeItems,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch customers' } });
  }
});

// POST /users/customers - Create new CUSTOMER user
router.post('/customers', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Email and password are required' } });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Email already exists' } });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        role: 'CUSTOMER',
        name: name?.trim() || null,
      },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        createdAt: true,
      },
    });

    res.status(201).json(user);
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create customer' } });
  }
});

// PUT /users/customers/:id - Update CUSTOMER user (name only, not role/email)
router.put('/customers/:id', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Customer not found' } });
    }

    if (user.role !== 'CUSTOMER') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Can only modify CUSTOMER role users' } });
    }

    const data: Record<string, unknown> = {};

    if (name !== undefined) {
      data.name = name?.trim() || null;
    }

    if (email !== undefined) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (normalizedEmail !== user.email) {
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
          return res.status(409).json({ error: { code: 'CONFLICT', message: 'Email already exists' } });
        }
        data.email = normalizedEmail;
      }
    }

    if (password !== undefined && password !== '') {
      data.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No valid fields to update' } });
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        createdAt: true,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update customer' } });
  }
});

// DELETE /users/customers/:id - Delete CUSTOMER user (soft delete: deactivate by setting role to DEACTIVATED)
router.delete('/customers/:id', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const authedReq = req as AuthedRequest;

    if (authedReq.actor?.userId === id) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot delete yourself' } });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Customer not found' } });
    }

    if (user.role !== 'CUSTOMER') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Can only delete CUSTOMER role users' } });
    }

    // Soft delete: mark as deactivated instead of hard delete
    // This preserves audit logs and any related data
    await prisma.user.update({
      where: { id },
      data: {
        role: 'DEACTIVATED',
        email: `deleted_${Date.now()}_${user.email}`,
      },
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete customer' } });
  }
});

// GET /users - List all users with pagination, search, role filter, active filter
router.get('/', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query?.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit ?? 50)));
    const skip = (page - 1) * limit;
    const search = String(req.query?.search ?? '').trim();
    const role = req.query?.role ? String(req.query.role) : undefined;
    // active filter not supported (User model has no active field)
    // const activeParam = req.query?.active;
    // const active = activeParam !== undefined ? String(activeParam) === 'true' : undefined;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { email: { contains: search } },
        { name: { contains: search } },
      ];
    }
    if (role) where.role = role;
    // if (active !== undefined) where.active = active;

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          role: true,
          name: true,
          createdAt: true,
          preferences: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    const safeItems = items.map((user) => {
      let mustChangePassword = false;
      try {
        const prefs = JSON.parse(user.preferences || '{}');
        mustChangePassword = !!prefs.mustChangePassword;
      } catch { /* ignore */ }
      return {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        createdAt: user.createdAt,
        mustChangePassword,
      };
    });

    res.json({
      items: safeItems,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch users' } });
  }
});

// PUT /users/:id - Update user (name, email, role)
router.put('/:id', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, email, role } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    const data: Record<string, unknown> = {};

    if (name !== undefined) {
      data.name = name?.trim() || null;
    }

    if (email !== undefined) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (normalizedEmail !== user.email) {
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
          return res.status(409).json({ error: { code: 'CONFLICT', message: 'Email already exists' } });
        }
        data.email = normalizedEmail;
      }
    }

    if (role !== undefined) {
      const validRoles = ['ADMIN', 'OPERATOR', 'CUSTOMER', 'DEACTIVATED'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz rol' } });
      }
      data.role = role;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No valid fields to update' } });
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        createdAt: true,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update user' } });
  }
});

// DELETE /users/:id - Deactivate user (soft delete)
router.delete('/:id', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const authedReq = req as AuthedRequest;

    if (authedReq.actor?.userId === id) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot delete yourself' } });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    // Soft delete: mark as deactivated
    await prisma.user.update({
      where: { id },
      data: {
        role: 'DEACTIVATED',
        email: `deleted_${Date.now()}_${user.email}`,
      },
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete user' } });
  }
});

export default router;