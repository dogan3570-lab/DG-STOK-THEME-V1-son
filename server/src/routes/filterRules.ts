import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';

const router = Router();

// ==================== TYPES ====================
interface FilterRuleRow {
  id: string;
  name: string;
  xmlSourceId: string | null;
  marketplaceId: string | null;
  desiMode: string;          // 'xml' | 'manual' | 'none'
  manualDesi: number | null;
  minPurchasePrice: number | null;
  maxPurchasePrice: number | null;
  active: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

// ==================== HELPER ====================
function parseRule(row: any): FilterRuleRow {
  return {
    id: row.id,
    name: row.name,
    xmlSourceId: row.xmlSourceId,
    marketplaceId: row.marketplaceId,
    desiMode: row.desiMode || 'xml',
    manualDesi: row.manualDesi,
    minPurchasePrice: row.minPurchasePrice,
    maxPurchasePrice: row.maxPurchasePrice,
    active: !!row.active,
    priority: row.priority ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Priority hesaplama: daha spesifik = daha yüksek öncelik
// 1. Tek XML + Tek Pazaryeri = 30
// 2. Tek XML + Tüm Pazaryerleri = 20
// 3. Tüm XML'ler + Tek Pazaryeri = 10
// 4. Tüm XML'ler + Tüm Pazaryerleri = 0
function calculatePriority(xmlSourceId: string | null, marketplaceId: string | null): number {
  let p = 0;
  if (xmlSourceId) p += 20;
  if (marketplaceId) p += 10;
  return p;
}

// ==================== GET /filter-rules ====================
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "FilterRule" ORDER BY priority DESC, createdAt DESC`
    );
    const rules = rows.map(parseRule);

    // XML kaynak isimlerini ekle
    const xmlIds = rules.filter(r => r.xmlSourceId).map(r => r.xmlSourceId!);
    const mpIds = rules.filter(r => r.marketplaceId).map(r => r.marketplaceId!);

    let xmlNames: Record<string, string> = {};
    let mpNames: Record<string, string> = {};

    if (xmlIds.length > 0) {
      const uniqueXmlIds = [...new Set(xmlIds)];
      const xmlRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, name FROM "XmlSource" WHERE id IN (${uniqueXmlIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',')})`
      );
      xmlNames = Object.fromEntries(xmlRows.map(r => [r.id, r.name]));
    }
    if (mpIds.length > 0) {
      const uniqueMpIds = [...new Set(mpIds)];
      const mpRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, name FROM "Marketplace" WHERE id IN (${uniqueMpIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',')})`
      );
      mpNames = Object.fromEntries(mpRows.map(r => [r.id, r.name]));
    }

    const enriched = rules.map(r => ({
      ...r,
      xmlSourceName: r.xmlSourceId ? (xmlNames[r.xmlSourceId] || 'Bilinmeyen') : 'Tüm XML\'ler',
      marketplaceName: r.marketplaceId ? (mpNames[r.marketplaceId] || 'Bilinmeyen') : 'Tüm Pazaryerleri',
    }));

    return res.json({ items: enriched });
  } catch (error) {
    console.error('[filter-rules] GET error:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Kurallar yüklenemedi' } });
  }
});

// ==================== POST /filter-rules ====================
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      name, xmlSourceId, marketplaceId,
      desiMode, manualDesi,
      minPurchasePrice, maxPurchasePrice,
      active,
    } = req.body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Kural adı zorunludur' } });
    }

    const validDesiModes = ['xml', 'manual', 'none'];
    const mode = validDesiModes.includes(desiMode) ? desiMode : 'xml';

    if (mode === 'manual' && (manualDesi == null || typeof manualDesi !== 'number' || manualDesi <= 0)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Manuel desi sıfırdan büyük olmalıdır' } });
    }

    if (minPurchasePrice != null && maxPurchasePrice != null && minPurchasePrice > maxPurchasePrice) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Min fiyat maks fiyatdan büyük olamaz' } });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const priority = calculatePriority(xmlSourceId || null, marketplaceId || null);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "FilterRule" (id, name, xmlSourceId, marketplaceId, desiMode, manualDesi, minPurchasePrice, maxPurchasePrice, active, priority, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      name.trim(),
      xmlSourceId || null,
      marketplaceId || null,
      mode,
      mode === 'manual' ? manualDesi : null,
      minPurchasePrice != null ? minPurchasePrice : null,
      maxPurchasePrice != null ? maxPurchasePrice : null,
      active !== false ? 1 : 0,
      priority,
      now,
      now,
    );

    return res.status(201).json({ id, ok: true });
  } catch (error) {
    console.error('[filter-rules] POST error:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Kural oluşturulamadı' } });
  }
});

// ==================== PUT /filter-rules/:id ====================
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? '');
    if (!id || !/^[0-9a-fA-F-]{10,40}$/.test(id)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz kural kimliği' } });
    }

    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "FilterRule" WHERE id = ?`, id
    );
    if (!existing.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Kural bulunamadı' } });
    }

    const {
      name, xmlSourceId, marketplaceId,
      desiMode, manualDesi,
      minPurchasePrice, maxPurchasePrice,
      active,
    } = req.body ?? {};

    const validDesiModes = ['xml', 'manual', 'none'];
    const mode = desiMode && validDesiModes.includes(desiMode) ? desiMode : undefined;

    if (mode === 'manual' && (manualDesi == null || typeof manualDesi !== 'number' || manualDesi <= 0)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Manuel desi sıfırdan büyük olmalıdır' } });
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name.trim()); }
    if (xmlSourceId !== undefined) { updates.push('xmlSourceId = ?'); values.push(xmlSourceId || null); }
    if (marketplaceId !== undefined) { updates.push('marketplaceId = ?'); values.push(marketplaceId || null); }
    if (mode !== undefined) { updates.push('desiMode = ?'); values.push(mode); }
    if (manualDesi !== undefined) { updates.push('manualDesi = ?'); values.push(mode === 'manual' ? manualDesi : null); }
    if (minPurchasePrice !== undefined) { updates.push('minPurchasePrice = ?'); values.push(minPurchasePrice || null); }
    if (maxPurchasePrice !== undefined) { updates.push('maxPurchasePrice = ?'); values.push(maxPurchasePrice || null); }
    if (active !== undefined) { updates.push('active = ?'); values.push(active ? 1 : 0); }

    if (updates.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Güncellenecek alan yok' } });
    }

    // Priority'yi yeniden hesapla
    const newXmlId = xmlSourceId !== undefined ? (xmlSourceId || null) : existing[0].xmlSourceId;
    const newMpId = marketplaceId !== undefined ? (marketplaceId || null) : existing[0].marketplaceId;
    const newPriority = calculatePriority(newXmlId, newMpId);
    updates.push('priority = ?');
    values.push(newPriority);

    updates.push('updatedAt = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await prisma.$executeRawUnsafe(
      `UPDATE "FilterRule" SET ${updates.join(', ')} WHERE id = ?`,
      ...values,
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error('[filter-rules] PUT error:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Kural güncellenemedi' } });
  }
});

// ==================== DELETE /filter-rules/:id ====================
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? '');
    if (!id || !/^[0-9a-fA-F-]{10,40}$/.test(id)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz kural kimliği' } });
    }

    const result = await prisma.$executeRawUnsafe(
      `DELETE FROM "FilterRule" WHERE id = ?`, id
    );

    if (result === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Kural bulunamadı' } });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('[filter-rules] DELETE error:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Kural silinemedi' } });
  }
});

// ==================== GET /filter-rules/resolve ====================
// Verilen xmlSourceId + marketplaceId için en uygun kuralı döndür
router.get('/resolve', requireAuth, async (req: Request, res: Response) => {
  try {
    const xmlSourceId = req.query?.xmlSourceId ? String(req.query.xmlSourceId) : null;
    const marketplaceId = req.query?.marketplaceId ? String(req.query.marketplaceId) : null;

    const rules = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "FilterRule" WHERE active = 1 ORDER BY priority DESC`
    );

    // Kural eşleştirmesi: en yüksek öncelikli eşleşen kuralı bul
    let matched: FilterRuleRow | null = null;
    for (const rule of rules) {
      const r = parseRule(rule);
      const xmlMatch = !r.xmlSourceId || r.xmlSourceId === xmlSourceId;
      const mpMatch = !r.marketplaceId || r.marketplaceId === marketplaceId;
      if (xmlMatch && mpMatch) {
        matched = r;
        break; // En yüksek öncelikli eşleşen
      }
    }

    return res.json({ rule: matched });
  } catch (error) {
    console.error('[filter-rules] RESOLVE error:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Kural çözümlenemedi' } });
  }
});

export default router;
