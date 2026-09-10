import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole } from '../auth/authMiddleware.ts';
import { encryptApiKey } from '../services/crypto.ts';
import { getAllProviders, testProvider, getOpenRouterFreeModels } from '../services/aiGateway.ts';
import { getOpenRouterStatus, discoverAndPersist, getRegistry } from '../services/openRouterManager.ts';
import { getOmniRouteStatus, discoverAndPersist as omniRouteDiscover, getRegistry as omniRouteGetRegistry, testModel as omniRouteTestModel, resetModelState as omniRouteResetModelState } from '../services/omniRouteManager.ts';
import { getOrchestratorStatus, getModelStates, dispatchRequest, setModelQuota, resetModelHealth, resetAllQuotas, executeMasterRequest, explainRouting, getMasterStatus, getMasterTrace, notifyAvailabilitySignal, getAvailabilitySnapshot, invalidateCandidateCache, type TaskType } from '../services/omniRouteOrchestrator.ts';
import { getMasterConfig, updateMasterConfig, redactMasterConfig, DEFAULT_MASTER_CONFIG } from '../services/masterConfig.ts';

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

// ==================== SIMPLE AI CONTROL CENTER ====================
// Kullanıcıya gösterilen tek sade görünüm: AI durumu + şu anki AI + provider kartları.
// Debug/teknik detay (endpoint, HTTP status, stack) ASLA döndürülmez.

/** currentAI source+model'den kullanıcının bildiği provider adını çıkar. */
function simpleProviderLabel(source: string, modelId: string): string {
  if (source === 'deepseek') return 'DeepSeek';
  if (source === 'openrouter') return 'OpenRouter';
  if (source === 'nvidia') return 'NVIDIA';
  if (source === 'openai') return 'OpenAI';
  if (source === 'omniroute') {
    // Router üzerinden gelen gerçek sağlayıcıyı model prefix'inden çöz
    const p = (modelId.split('/')[0] || '').toLowerCase();
    if (p === 'nvidia') return 'NVIDIA';
    if (p === 'opencode' || p === 'oc') return 'OpenCode';
    if (p === 'deepseek') return 'DeepSeek';
    if (p === 'openai') return 'OpenAI';
    return 'OmniRoute (Router)';
  }
  return source ? source.charAt(0).toUpperCase() + source.slice(1) : '—';
}

// GET /ai-settings/simple — Yeni sade AI Control Center verisi
router.get('/simple', requireAuth, async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.aIProviderConfig.findMany({
      where: { provider: { in: ['nvidia', 'openrouter', 'opencode', 'deepseek'] } },
    });
    const byProvider = new Map(rows.map((r) => [r.provider, r]));

    const ORDER = [
      { provider: 'nvidia', label: 'NVIDIA' },
      { provider: 'openrouter', label: 'OpenRouter' },
      { provider: 'opencode', label: 'OpenCode' },
      { provider: 'deepseek', label: 'DeepSeek' },
    ];

    const providers = ORDER.map(({ provider, label }) => {
      const row = byProvider.get(provider);
      const active = !!row?.active;
      const hasKey = !!row?.apiKeyEncrypted;
      return {
        provider,
        label: row?.displayName || label,
        tier: 'FREE',
        active,
        hasKey,
        // Basit kullanıcı durumu — teknik hata metni gösterilmez
        statusText: !active ? 'Kapalı' : !hasKey ? 'API Key gerekli' : 'Kullanılabilir',
      };
    });

    // Gerçek routing durumu: eligible havuz + son BAŞARILI inference (tahmin YOK)
    let available = false;
    let currentAI: { provider: string; model: string; at: string } | null = null;
    try {
      const snapshot = await getAvailabilitySnapshot();
      available = snapshot.level === 'ACTIVE';
      const cur = snapshot.currentAI;
      if (cur && cur.source) {
        currentAI = { provider: simpleProviderLabel(cur.source, cur.modelId), model: cur.modelId, at: cur.at };
      }
    } catch {
      available = providers.some((p) => p.active && p.hasKey);
    }

    res.json({
      ok: true,
      ai: {
        available,
        message: available ? 'AI kullanılabilir' : 'Aktif AI sağlayıcısı bulunmuyor.',
        currentAI,
      },
      providers,
    });
  } catch (error) {
    console.error('[ai-settings] GET /simple error:', error);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'AI durumu alınamadı' } });
  }
});

// GET /ai-settings/openrouter/models — Gerçek OpenRouter katalogundan free modeller
router.get('/openrouter/models', requireAuth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    const items = await getOpenRouterFreeModels();
    res.json({ items });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Katalog alınamadı';
    const status = msg.includes('yapılandırılmamış') ? 400 : 502;
    res.status(status).json({ ok: false, error: { code: 'OPENROUTER_CATALOG_FAILED', message: msg } });
  }
});

// GET /ai-settings/openrouter/status — AI Control Center durum paneli
router.get('/openrouter/status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const status = await getOpenRouterStatus();
    res.json({ ok: true, status });
  } catch (error) {
    console.error('[ai-settings] openrouter/status error:', error);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'OpenRouter durumu alınamadı' } });
  }
});

// POST /ai-settings/openrouter/discover — Model discovery tetikle (manuel, backoff'a uyar)
router.post('/openrouter/discover', requireAuth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    const result = await discoverAndPersist();
    res.json({ ok: result.ok, freeCount: result.freeCount, totalCount: result.totalCount, error: result.error });
  } catch (error) {
    console.error('[ai-settings] openrouter/discover error:', error);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Model keşfi başarısız' } });
  }
});

// GET /ai-settings/openrouter/registry — DB'deki model registry içeriği (admin)
router.get('/openrouter/registry', requireAuth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    const registry = await getRegistry();
    res.json({ ok: true, registry });
  } catch (error) {
    console.error('[ai-settings] openrouter/registry error:', error);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Registry alınamadı' } });
  }
});

// GET /ai-settings/omniroute/status — OmniRoute durum paneli
router.get('/omniroute/status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const status = await getOmniRouteStatus();
    res.json({ ok: true, status });
  } catch (error) {
    console.error('[ai-settings] omniroute/status error:', error);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'OmniRoute durumu alınamadı' } });
  }
});

// GET /ai-settings/omniroute/models — OmniRoute model listesi
router.get('/omniroute/models', requireAuth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    const registry = await omniRouteGetRegistry();
    const freeModels = registry.models.filter(m => m.free);
    res.json({ ok: true, models: registry.models, freeModels, totalCount: registry.models.length, freeCount: freeModels.length });
  } catch (error) {
    console.error('[ai-settings] omniroute/models error:', error);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'OmniRoute model listesi alınamadı' } });
  }
});

// POST /ai-settings/omniroute/discover — OmniRoute model discovery tetikle
router.post('/omniroute/discover', requireAuth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    const result = await omniRouteDiscover();
    res.json({ ok: result.ok, freeCount: result.freeCount, totalCount: result.totalCount, error: result.error });
  } catch (error) {
    console.error('[ai-settings] omniroute/discover error:', error);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'OmniRoute model keşfi başarısız' } });
  }
});

// POST /ai-settings/omniroute/test — OmniRoute model test
router.post('/omniroute/test', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    // FIX(RT-ACC): UI 'modelId' gönderiyordu, backend yalnız 'model' okuyordu →
    // model-spesifik testler sessizce best-free testine dönüşüyordu. İkisi de kabul edilir.
    const rawModel = req.body?.model ?? req.body?.modelId;
    const modelId = typeof rawModel === 'string' && rawModel.trim().length > 0 ? rawModel.trim() : undefined;
    const result = await omniRouteTestModel(modelId);
    res.json(result);
  } catch (error) {
    console.error('[ai-settings] omniroute/test error:', error);
    res.status(500).json({ ok: false, model: 'unknown', latencyMs: 0, error: 'Test sırasında hata oluştu', errorCode: 'INTERNAL_ERROR' });
  }
});

// POST /ai-settings/omniroute/reset — Manager registry cezalarını sıfırla
// { } | { all: true } → tüm modeller; { modelId } → tek model.
// FIX(RT-ACC): Kullanıcı "cooldown bitmesini beklemek" zorunda kalmasın —
// orchestrator reset'i manager karantinasını temizlemiyordu (iki beyin boşluğu).
router.post('/omniroute/reset', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const modelId = typeof req.body?.modelId === 'string' && req.body.modelId.trim().length > 0 ? req.body.modelId.trim() : undefined;
    const result = await omniRouteResetModelState(modelId);
    res.json({ ok: true, resetCount: result.resetCount });
  } catch (error) {
    console.error('[ai-settings] omniroute/reset error:', error);
    res.status(500).json({ ok: false, error: 'Sıfırlama başarısız' });
  }
});

// POST /ai-settings/openrouter/reset — OpenRouter registry cezalarını sıfırla
router.post('/openrouter/reset', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const modelId = typeof req.body?.modelId === 'string' && req.body.modelId.trim().length > 0 ? req.body.modelId.trim() : undefined;
    const { resetModelState } = await import('../services/openRouterManager.ts');
    const result = await resetModelState(modelId);
    res.json({ ok: true, resetCount: result.resetCount });
  } catch (error) {
    console.error('[ai-settings] openrouter/reset error:', error);
    res.status(500).json({ ok: false, error: 'Sıfırlama başarısız' });
  }
});

// GET /ai-settings/opencode/models — Keşfedilen OpenCode free modeller
router.get('/opencode/models', requireAuth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    const { discoverOpenCodeModels, getActiveFreeModels } = await import('../services/openCodeModels.ts');
    const models = await discoverOpenCodeModels(false);
    const activeFree = await getActiveFreeModels();
    res.json({ items: models, activeFreeCount: activeFree.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Model kataloğu alınamadı';
    res.status(502).json({ ok: false, error: { code: 'OPENCODE_CATALOG_FAILED', message: msg } });
  }
});

// POST /ai-settings/opencode/discover — OpenCode model discovery tetikle
router.post('/opencode/discover', requireAuth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    const { discoverOpenCodeModels } = await import('../services/openCodeModels.ts');
    const models = await discoverOpenCodeModels(true);
    res.json({ ok: true, totalCount: models.length, freeCount: models.filter(m => m.freeStatus === 'FREE').length });
  } catch (error) {
    console.error('[ai-settings] opencode/discover error:', error);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'OpenCode model keşfi başarısız' } });
  }
});

// DELETE /ai-settings/:provider/key — API key sil (credential DB'den kaldırılır)
router.delete('/:provider/key', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider);
    const existing = await prisma.aIProviderConfig.findUnique({ where: { provider } });
    if (!existing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sağlayıcı bulunamadı' } });

    await prisma.aIProviderConfig.update({
      where: { provider },
      data: { apiKeyEncrypted: null, apiKeyIv: null, apiKeyTag: null, lastStatus: 'unknown', lastError: null },
    });

    await prisma.auditLog.create({
      data: {
        action: 'AI_PROVIDER_KEY_DELETE',
        entity: 'ai_provider',
        entityId: existing.id,
        details: `${existing.displayName} API key silindi`,
        actorUserId: (req as any).actor?.userId || null,
      },
    });

    res.json({ ok: true, message: 'API key silindi' });
  } catch (error) {
    console.error('[ai-settings] DELETE key error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'API key silinemedi' } });
  }
});

// ==================== MASTER BRAIN ENDPOINTS (V2) ====================

// GET /ai-settings/master/status — SYSTEM durumu + metrics (#29/#35/#52)
router.get('/master/status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const status = await getMasterStatus();
    const cfg = await getMasterConfig();
    res.json({ ok: true, status, config: redactMasterConfig(cfg) });
  } catch (error) {
    console.error('[ai-settings] master/status error:', error);
    res.status(500).json({ ok: false, error: 'Master durum alınamadı' });
  }
});

// GET /ai-settings/master/routing-table?task=GENERAL — LIVE ROUTING TABLE + WHY (#30)
router.get('/master/routing-table', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const taskType = String(req.query.task || 'GENERAL') as TaskType;
    const limit = Math.min(30, Math.max(3, Number(req.query.limit) || 14));
    const table = await explainRouting(taskType, undefined, undefined, limit);
    res.json({ ok: true, ...table });
  } catch (error) {
    console.error('[ai-settings] master/routing-table error:', error);
    res.status(500).json({ ok: false, error: 'Routing tablosu alınamadı' });
  }
});

// GET /ai-settings/master/trace — FALLBACK TRACE (#31/#34)
router.get('/master/trace', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    res.json({ ok: true, items: getMasterTrace(limit) });
  } catch (error) {
    console.error('[ai-settings] master/trace error:', error);
    res.status(500).json({ ok: false, error: 'Trace alınamadı' });
  }
});

// POST /ai-settings/master/test — Gerçek master inference testi (#61)
router.post('/master/test', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const { messages, taskType, maxTokens, temperature, pinnedModelId } = req.body || {};
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ ok: false, error: 'messages array gerekli' });
    }
    const result = await executeMasterRequest({
      taskType: (taskType || 'GENERAL') as TaskType,
      messages: messages.map((m: any) => ({ role: m.role || 'user', content: m.content || '' })),
      maxTokens: maxTokens || 300,
      temperature: temperature ?? 0,
      metadata: {
        module: 'master-ui-test',
        ...(pinnedModelId ? { pinnedModelId } : {}),
      },
    });
    res.json(result);
  } catch (error) {
    console.error('[ai-settings] master/test error:', error);
    res.status(500).json({ ok: false, error: 'Test sırasında hata oluştu' });
  }
});

// PUT /ai-settings/master/config — Merkezi policy güncelle (#42); secret içeremez
router.put('/master/config', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const patch = req.body || {};
    // Secret koruması: config'te key/token alanı kabul edilmez
    const json = JSON.stringify(patch).toLowerCase();
    if (json.includes('apikey') || json.includes('api_key') || json.includes('secret') || json.includes('token')) {
      return res.status(400).json({ ok: false, error: 'config credential içeremez' });
    }
    const next = await updateMasterConfig(patch);
    // V3 (#9): koşul değişimi → supervisor bekleme süresini sıfırla
    notifyAvailabilitySignal();
    res.json({ ok: true, config: redactMasterConfig(next) });
  } catch (error) {
    console.error('[ai-settings] master/config error:', error);
    res.status(500).json({ ok: false, error: 'Config güncellenemedi' });
  }
});

// GET /ai-settings/orchestrator/status — Orchestrator durumu
router.get('/orchestrator/status', requireAuth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    const status = await getOrchestratorStatus();
    res.json({ ok: true, status });
  } catch (error) {
    console.error('[ai-settings] orchestrator/status error:', error);
    res.status(500).json({ ok: false, error: 'Orchestrator durumu alınamadı' });
  }
});

// GET /ai-settings/orchestrator/models — Tüm model state'leri
router.get('/orchestrator/models', requireAuth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    const models = await getModelStates();
    res.json({ ok: true, models });
  } catch (error) {
    console.error('[ai-settings] orchestrator/models error:', error);
    res.status(500).json({ ok: false, error: 'Model listesi alınamadı' });
  }
});

// POST /ai-settings/orchestrator/test — Orchestrator üzerinden gerçek test
router.post('/orchestrator/test', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const { messages, taskType, maxTokens, temperature } = req.body || {};
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ ok: false, error: 'messages array gerekli' });
    }
    const result = await dispatchRequest(
      messages.map((m: any) => ({ role: m.role || 'user', content: m.content || '' })),
      taskType || 'GENERAL',
      maxTokens || 200,
      temperature || 0.7
    );
    res.json(result);
  } catch (error) {
    console.error('[ai-settings] orchestrator/test error:', error);
    res.status(500).json({ ok: false, error: 'Test sırasında hata oluştu' });
  }
});

// POST /ai-settings/orchestrator/quota — Model kotasını ayarla (test için)
router.post('/orchestrator/quota', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId : '';
    const percent = Number(req.body?.percent);
    if (!modelId) return res.status(400).json({ ok: false, error: 'modelId gerekli' });
    if (isNaN(percent) || percent < 0 || percent > 100) {
      return res.status(400).json({ ok: false, error: 'percent 0-100 arası olmalı' });
    }
    await setModelQuota(modelId, percent);
    res.json({ ok: true, modelId, percent });
  } catch (error) {
    console.error('[ai-settings] orchestrator/quota error:', error);
    res.status(500).json({ ok: false, error: 'Kota ayarlanamadı' });
  }
});

// POST /ai-settings/orchestrator/reset — Model sağlık durumunu sıfırla
router.post('/orchestrator/reset', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId : '';
    if (!modelId) return res.status(400).json({ ok: false, error: 'modelId gerekli' });
    await resetModelHealth(modelId);
    res.json({ ok: true, modelId, message: 'Model health reset' });
  } catch (error) {
    console.error('[ai-settings] orchestrator/reset error:', error);
    res.status(500).json({ ok: false, error: 'Sıfırlama başarısız' });
  }
});

// POST /ai-settings/orchestrator/reset-all — Tüm kota ve sağlık durumlarını sıfırla
router.post('/orchestrator/reset-all', requireAuth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    await resetAllQuotas();
    res.json({ ok: true, message: 'All quotas and health states reset' });
  } catch (error) {
    console.error('[ai-settings] orchestrator/reset-all error:', error);
    res.status(500).json({ ok: false, error: 'Sıfırlama başarısız' });
  }
});

// ==================== PARAMETRIC ROUTES (provider-specific) ====================

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
    if (active !== undefined) {
      updateData.active = Boolean(active);
      // Provider yeniden açıldığında eski/stale hata görünümü temizlenir
      // (ör. geçmişte kaydedilmiş "omniroutecomplete is not defined" gibi artıklar).
      if (active === true) {
        updateData.lastStatus = 'configured';
        updateData.lastError = null;
      }
    }
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

    // OFF/ON değişikliği anında routing havuzuna işlensin (cache TTL beklemesin)
    if (active !== undefined || apiKey) {
      invalidateCandidateCache();
      notifyAvailabilitySignal();
    }

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

// DELETE /ai-settings/:provider — Provider'ı sil
router.delete('/:provider', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider);
    const existing = await prisma.aIProviderConfig.findUnique({ where: { provider } });
    if (!existing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sağlayıcı bulunamadı' } });

    await prisma.aIProviderConfig.delete({ where: { provider } });

    await prisma.auditLog.create({
      data: {
        action: 'AI_PROVIDER_DELETE',
        entity: 'ai_provider',
        entityId: existing.id,
        details: `${existing.displayName} silindi`,
        meta: JSON.stringify({ provider: existing.provider }),
        actorUserId: (req as any).actor?.userId || null,
      },
    });

    res.json({ ok: true, deleted: provider });
  } catch (error) {
    console.error('[ai-settings] DELETE /:provider error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Sağlayıcı silinemedi' } });
  }
});

// POST /ai-settings/:provider/test — Gerçek API bağlantısı testi
router.post('/:provider/test', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider);
    const modelOverride = typeof req.body?.model === 'string' && req.body.model.trim().length > 0 ? req.body.model.trim() : undefined;
    const result = await testProvider(provider, modelOverride);
    res.json(result);
  } catch (error) {
    console.error('[ai-settings] POST /:provider/test error:', error);
    res.status(500).json({ ok: false, provider: String(req.params.provider), model: 'unknown', latencyMs: 0, error: 'Test sırasında hata oluştu', errorCode: 'INTERNAL_ERROR' });
  }
});

export default router;
