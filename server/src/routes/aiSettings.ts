import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole } from '../auth/authMiddleware.ts';
import { encryptApiKey } from '../services/crypto.ts';
import { getAllProviders, testProvider } from '../services/aiGateway.ts';

const router = Router();

function maskApiKey(plaintext: string): string {
  if (!plaintext || plaintext.length < 8) return '••••••••';
  return plaintext.substring(0, 4) + '•'.repeat(Math.min(plaintext.length - 8, 16)) + plaintext.substring(plaintext.length - 4);
}

// GET /ai-settings — Tüm provider'ları listele (API key masked)
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const providers = await getAllProviders();
    const result = providers.map((p) => ({
      id: p.id,
      provider: p.provider,
      displayName: p.displayName,
      baseUrl: p.baseUrl,
      model: p.model,
      priority: p.priority,
      active: p.active,
      lastStatus: p.lastStatus,
      lastError: p.lastError,
      totalRequests: p.totalRequests,
      successfulRequests: p.successfulRequests,
      failedRequests: p.failedRequests,
      lastUsedAt: p.lastUsedAt,
      apiKeyConfigured: false,
    }));

    // Check which providers have API keys configured
    const dbProviders = await prisma.aIProviderConfig.findMany({
      select: { provider: true, apiKeyEncrypted: true },
    });
    for (const dbP of dbProviders) {
      const r = result.find((x) => x.provider === dbP.provider);
      if (r) r.apiKeyConfigured = !!dbP.apiKeyEncrypted;
    }

    res.json({ items: result });
  } catch (error) {
    console.error('[ai-settings] GET error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'AI ayarları alınamadı' } });
  }
});

// GET /ai-settings/:provider — Tek provider detayı
router.get('/:provider', requireAuth, async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider);
    const p = await prisma.aIProviderConfig.findUnique({ where: { provider } });
    if (!p) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sağlayıcı bulunamadı' } });

    res.json({
      id: p.id,
      provider: p.provider,
      displayName: p.displayName,
      baseUrl: p.baseUrl,
      model: p.model,
      priority: p.priority,
      active: p.active,
      lastStatus: p.lastStatus,
      lastError: p.lastError,
      totalRequests: p.totalRequests,
      successfulRequests: p.successfulRequests,
      failedRequests: p.failedRequests,
      lastUsedAt: p.lastUsedAt,
      apiKeyConfigured: !!p.apiKeyEncrypted,
    });
  } catch (error) {
    console.error('[ai-settings] GET /:provider error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Sağlayıcı bilgisi alınamadı' } });
  }
});

// PUT /ai-settings/:provider — Provider güncelle (apiKey varsa encrypt et)
router.put('/:provider', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider);
    const { apiKey, model, priority, active, baseUrl } = req.body;

    const existing = await prisma.aIProviderConfig.findUnique({ where: { provider } });
    if (!existing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sağlayıcı bulunamadı' } });

    const updateData: any = {};

    if (model !== undefined) updateData.model = model;
    if (priority !== undefined) updateData.priority = Number(priority);
    if (active !== undefined) updateData.active = Boolean(active);
    if (baseUrl !== undefined) updateData.baseUrl = baseUrl;

    // API key — only update if provided and non-empty
    if (apiKey && typeof apiKey === 'string' && apiKey.trim().length > 0) {
      const { encrypted, iv, tag } = encryptApiKey(apiKey.trim());
      updateData.apiKeyEncrypted = encrypted;
      updateData.apiKeyIv = iv;
      updateData.apiKeyTag = tag;
      updateData.lastStatus = 'configured';
      updateData.lastError = null;
    }

    const updated = await prisma.aIProviderConfig.update({
      where: { provider },
      data: updateData,
    });

    await prisma.auditLog.create({
      data: {
        action: 'AI_PROVIDER_UPDATE',
        entity: 'ai_provider',
        entityId: updated.id,
        details: `${updated.displayName} güncellendi`,
        meta: JSON.stringify({ provider: updated.provider, active: updated.active }),
        actorUserId: (req as any).actor?.userId || null,
      },
    });

    res.json({
      ok: true,
      provider: updated.provider,
      displayName: updated.displayName,
      active: updated.active,
      priority: updated.priority,
      model: updated.model,
      apiKeyConfigured: !!updated.apiKeyEncrypted,
    });
  } catch (error) {
    console.error('[ai-settings] PUT /:provider error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Sağlayıcı güncellenemedi' } });
  }
});

// POST /ai-settings/:provider/test — Gerçek API bağlantısı testi
router.post('/:provider/test', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider);
    const result = await testProvider(provider);
    res.json(result);
  } catch (error) {
    console.error('[ai-settings] POST /:provider/test error:', error);
    res.status(500).json({ ok: false, provider: String(req.params.provider), model: 'unknown', latencyMs: 0, error: 'Test sırasında hata oluştu', errorCode: 'INTERNAL_ERROR' });
  }
});

export default router;
