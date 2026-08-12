import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';

const router = Router();

// GET /settings - Fetch all settings
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const settings = await prisma.setting.findMany();
    const map: Record<string, string> = {};
    for (const s of settings) {
      map[s.key] = s.value;
    }
    res.json({ items: map });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch settings' } });
  }
});

// PUT /settings - Save settings
router.put('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const data = req.body?.settings;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'settings zorunludur' } });
    }
    for (const [key, value] of Object.entries(data)) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    }
    res.json({ ok: true, message: 'Ayarlar kaydedildi' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to save settings' } });
  }
});

export default router;
