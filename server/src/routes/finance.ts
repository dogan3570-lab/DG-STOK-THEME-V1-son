import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../auth/authMiddleware.ts';

const router = Router();

// GET /finance — Finance verisi (Prisma'da FinancialEntry modeli yok)
// Reports.tsx'in beklediği format: { items: [], summary: [] }
// BLOCKED: Prisma schema/migration değişikliği bu görev kapsamında yasak.
// Gerçek finans veri kaynağı henüz mevcut değil.
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  return res.json({ items: [], summary: [] });
});

export default router;
