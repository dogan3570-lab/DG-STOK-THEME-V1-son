import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.ts';
import {reconcileProductGates, queueReconcileProductGates} from './readinessService.ts';
import { isMarketplaceOperational, invalidateOperationalMarketplaceCache } from './marketplaceTruth.ts';

export type ReconcileResult =
  | { ok: true; outcome: 'created' | 'exists'; id: string }
  | { ok: false; reason: 'product_missing' | 'marketplace_missing' | 'marketplace_inactive' | 'error'; message?: string };

/**
 * Bireysel ürün için pazaryeri state'ini (VERİ KÖPRÜSÜ) idempotent biçimde garanti eder.
 *
 * Kurallar (mission bölüm 4):
 *  - ürün yoksa      -> STOP (create edilmez)
 *  - pazaryeri yoksa -> STOP
 *  - pazaryeri inaktif -> STOP (DO NOT CREATE)
 *  - PMS varsa       -> duplicate yaratılmaz, mevcut satıra DOKUNULMAZ
 *  - PMS yoksa       -> PENDING olarak yaratılır
 *
 * ASLA yapmaz: READY yazmaz, categoryMatch/templateMatch/variantMatch/brandMatch
 * değiştirmez (4/4 gate ayrı akıştır), mevcut PMS state'ini reset etmez.
 */
export async function reconcileProductMarketplaceState(
  productId: string,
  marketplaceId: string
): Promise<ReconcileResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) {
    return { ok: false, reason: 'product_missing', message: 'Ürün bulunamadı' };
  }

  const marketplace = await prisma.marketplace.findUnique({
    where: { id: marketplaceId },
    select: { id: true, active: true, apiKey: true, apiSecret: true, apiUrl: true },
  });
  if (!marketplace) {
    return { ok: false, reason: 'marketplace_missing', message: 'Pazaryeri bulunamadı' };
  }
  if (!marketplace.active) {
    return { ok: false, reason: 'marketplace_inactive', message: 'Pazaryeri aktif değil' };
  }
  if (!isMarketplaceOperational(marketplace)) {
    return { ok: false, reason: 'marketplace_inactive', message: 'Pazaryeri yapılandırılmamış (API credential eksik)' };
  }

  try {
    const existing = await prisma.productMarketplaceState.findUnique({
      where: { productId_marketplaceId: { productId, marketplaceId } },
      select: { id: true },
    });
    if (existing) {
      return { ok: true, outcome: 'exists', id: existing.id };
    }
    const created = await prisma.productMarketplaceState.create({
      data: { productId, marketplaceId, status: 'PENDING' },
      select: { id: true },
    });
    queueReconcileProductGates(productId);
    return { ok: true, outcome: 'created', id: created.id };
  } catch (error: any) {
    // eşzamanlı create yarışı -> diğer istek slot'u aldı, duplicate değil
    if (error?.code === 'P2002') {
      const existing = await prisma.productMarketplaceState.findUnique({
        where: { productId_marketplaceId: { productId, marketplaceId } },
        select: { id: true },
      });
      if (existing) {
        return { ok: true, outcome: 'exists', id: existing.id };
      }
    }
    return { ok: false, reason: 'error', message: String(error) };
  }
}

export type ReconcileMarketplaceOptions = {
  /** ilerleme logu her N üründe bir basılır */
  logEvery?: number;
  /** çalıştırmayı erken sonlandırmak için (ör. sunucu kapanırken) */
  shouldStop?: () => boolean;
  actorUserId?: string | null;
};

export type ReconcileMarketplaceResult = {
  ok: boolean;
  marketplaceId: string;
  marketplaceActive: boolean;
  totalCandidates: number;
  existingCount: number;
  createdCount: number;
  chunks: number;
  message: string;
  error?: string;
};

/**
 * Bir pazaryerinin tüm mevcut ürünleriyle state'ini toplu olarak kapatır (backfill).
 * Chunk (BATCH 500) + resumable + idempotent. Her chunk kendi başına atomiktir;
 * process ölürse kaldığı yerden tekrar çalıştırılabilir (duplicate üretmez).
 *
 * Pazaryeri inaktif ise hiçbir PMS yaratılmaz ve ok:true (do-nothing) döner.
 * Sadece Product.xmlSourceId dolu (kaynağı belirli) ürünler hedeflenir.
 */
export async function reconcileMarketplace(
  marketplaceId: string,
  options?: ReconcileMarketplaceOptions
): Promise<ReconcileMarketplaceResult> {
  const BATCH = 500;
  const logEvery = options?.logEvery ?? 500;
  const shouldStop = options?.shouldStop ?? (() => false);

  const marketplace = await prisma.marketplace.findUnique({
    where: { id: marketplaceId },
    select: { id: true, active: true, name: true, apiKey: true, apiSecret: true, apiUrl: true },
  });
  if (!marketplace) {
    return {
      ok: false,
      marketplaceId,
      marketplaceActive: false,
      totalCandidates: 0,
      existingCount: 0,
      createdCount: 0,
      chunks: 0,
      message: 'Pazaryeri bulunamadı',
      error: 'MARKETPLACE_NOT_FOUND',
    };
  }
  if (!marketplace.active) {
    return {
      ok: true,
      marketplaceId,
      marketplaceActive: false,
      totalCandidates: 0,
      existingCount: 0,
      createdCount: 0,
      chunks: 0,
      message: 'Pazaryeri aktif değil — PMS oluşturulmadı',
    };
  }
  if (!isMarketplaceOperational(marketplace)) {
    return {
      ok: true,
      marketplaceId,
      marketplaceActive: false,
      totalCandidates: 0,
      existingCount: 0,
      createdCount: 0,
      chunks: 0,
      message: 'Pazaryeri yapılandırılmamış (API credential eksik) — PMS oluşturulmadı',
    };
  }

  let cursor: string | undefined;
  let totalCandidates = 0;
  let existingCount = 0;
  let createdCount = 0;
  let chunks = 0;

  while (true) {
    if (shouldStop()) {
      return {
        ok: true,
        marketplaceId,
        marketplaceActive: true,
        totalCandidates,
        existingCount,
        createdCount,
        chunks,
        message: 'shouldStop ile erken sonlandırıldı (resumable)',
      };
    }

    const batch = await prisma.product.findMany({
      where: {
        xmlSourceId: { not: null },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    if (batch.length === 0) break;

    chunks++;
    totalCandidates += batch.length;

    const ids = batch.map((p) => p.id);
    const existing = await prisma.productMarketplaceState.findMany({
      where: { productId: { in: ids }, marketplaceId },
      select: { productId: true },
    });
    const existingSet = new Set(existing.map((s) => s.productId));
    existingCount += existing.length;

    const missing = ids.filter((id) => !existingSet.has(id));
    if (missing.length > 0) {
      // SQLite: INSERT OR IGNORE (unique productId+marketplaceId) — idempotent,
      // eşzamanlı create yarışında bile duplicate üretmez.
      const created = await prisma.$executeRaw`
        INSERT OR IGNORE INTO ProductMarketplaceState (id, productId, marketplaceId, status)
        VALUES ${Prisma.join(
          missing.map((productId) => Prisma.sql`(${productId}, ${productId}, ${marketplaceId}, 'PENDING')`),
          ', '
        )}
      `;
      createdCount += created;
    }

    if (chunks % Math.ceil(logEvery / BATCH) === 0 || batch.length < BATCH) {
      console.log(
        `[Reconcile] ${marketplace.name} chunk=${chunks} total=${totalCandidates} existing=${existingCount} created=${createdCount}`
      );
    }

    cursor = batch[batch.length - 1].id;
  }

  const message = `${marketplace.name}: ${totalCandidates} ürün tarandı, ${existingCount} state mevcut, ${createdCount} PENDING oluşturuldu`;
  try {
    await prisma.auditLog.create({
      data: {
        action: 'MARKETPLACE_RECONCILE',
        entity: 'marketplace',
        entityId: marketplaceId,
        actorUserId: options?.actorUserId ?? null,
        meta: JSON.stringify({ totalCandidates, existingCount, createdCount, chunks }),
        details: message,
      },
    });
  } catch (logError) {
    console.error('[Reconcile] AuditLog creation failed:', logError);
  }

  return {
    ok: true,
    marketplaceId,
    marketplaceActive: true,
    totalCandidates,
    existingCount,
    createdCount,
    chunks,
    message,
  };
}

/** Operasyonel tüm pazaryerlerini sırayla kapatır (aktivasyon/backfill aracı). */
export async function reconcileAllActiveMarketplaces(
  options?: ReconcileMarketplaceOptions
): Promise<Array<ReconcileMarketplaceResult>> {
  const allMarketplaces = await prisma.marketplace.findMany({
    where: { active: true },
    select: { id: true, apiKey: true, apiSecret: true, apiUrl: true },
    orderBy: { createdAt: 'asc' },
  });
  const operationalMps = allMarketplaces.filter(mp => isMarketplaceOperational(mp));
  const results: Array<ReconcileMarketplaceResult> = [];
  for (const mp of operationalMps) {
    if (options?.shouldStop?.()) break;
    results.push(await reconcileMarketplace(mp.id, options));
  }
  return results;
}