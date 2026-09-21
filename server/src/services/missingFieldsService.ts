/**
 * MISSING FIELDS SERVICE — Pazaryeri zorunlu alan eksikliklerini GERÇEK gate
 * sonucuna göre tespit eden servis.
 *
 * DOĞRULUK KAYNAĞI:
 *   - Varyantsız ürünler: gate step-3 mantığının kanıtlanmış eşdeğeri
 *     (required attribute'ların GERÇEK Trendyol katalogdan okunması +
 *      ürünün kalıcı TrendyolProductAttribute kaydının kontrolü).
 *     Bu eşdeğer, gerçek `evaluateTrendyolSendGate` ile birebir doğrulanmıştır.
 *   - Varyantlı ürünler: gerçek `evaluateTrendyolSendGate` çağrılır.
 *
 * KORUMA:
 *   - status=READY ve 4/4 gate DEĞİŞMEZ
 *   - ALREADY_SENDING / APPROVAL_PENDING / SENDING missing attribute SAYILMAZ
 *   - Uydurma attribute/valueId ÜRETİLMEZ
 *   - Duplicate ürün/attribute ÜRETİLMEZ
 *   - Cache eski eligibility'yi kalıcı gerçek kabul etmez (TTL zorunlu)
 */
import { prisma } from '../db/prisma.ts';
import { evaluateTrendyolSendGate } from './sendReadiness.ts';
import { proposeForProduct, applyProposals } from './attributeAutoComplete.ts';
import { fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from './trendyolCatalog.ts';
import { normalizeName } from './categoryBrandMapper.ts';
import fs from 'fs';
import path from 'path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MissingFieldItem {
  productId: string;
  title: string | null;
  sku: string | null;
  barcode: string | null;
  categoryId: string | null;
  brandName: string | null;
  xmlSourceId: string | null;
  marketplaceId: string;
  marketplaceKey: string;
  missingAttributes: Array<{
    attributeId: number;
    attributeName: string;
    currentValueId: number | null;
    currentValue: string | null;
    reason: string;
  }>;
  autoResolvedCount: number;
  unresolvedCount: number;
  status: 'NEEDS_USER' | 'AUTO_RESOLVED';
}

export interface MissingFieldsStats {
  totalMissing: number;
  autoResolved: number;
  needsUser: number;
  byField: Record<string, number>;
  distinctAttributes?: number;
}

export interface ResolveResult {
  ok: boolean;
  applied: number;
  skipped: number;
  newlyReady: boolean;
  details: string[];
  error?: string;
}

interface ReqAttr { id: number; name: string }

interface ScanResult {
  stats: MissingFieldsStats;
  products: MissingFieldItem[];
  evaluated: number;
  scannedAt: number;
}

// ─── Cache (TTL zorunlu; eski veri kalıcı gerçek kabul edilmez) ─────────────

const CATALOG_TTL_MS = 10 * 60 * 1000; // kategori attribute tanımları
const SCAN_TTL_MS = 30 * 1000;         // tarama sonucu (kısa; staleness sınırlı)
const MAX_SCAN = 3000;

const reqAttrCache = new Map<number, { data: ReqAttr[]; at: number }>();
let scanCache: { key: string; at: number; result: ScanResult } | null = null;
const scanInFlight = new Map<string, Promise<ScanResult>>();

// ── RTS için NON-BLOCKING blocked-set (snapshot + arka plan refresh) ─────────
// RTS istekleri gate taramasını BEKLEMEZ. Hazır snapshot varsa (taze veya stale)
// onu kullanır ve gerekirse arka planda yeniler. Snapshot yoksa RTS bloke edilmez;
// çağıran taraf `complete=false` alır ve ürünü "gönderilebilir" göstermemek için
// temkinli davranır.
const BLOCKED_CACHE_DIR = path.join(process.cwd(), '.cache');
const BLOCKED_SNAPSHOT_PATH = path.join(BLOCKED_CACHE_DIR, 'missing-fields-blocked.json');

interface BlockedSnapshot { ids: string[]; at: number; }
let blockedSnapshot: BlockedSnapshot | null = null;
let blockedSnapshotLoadTried = false;
let blockedWarmPromise: Promise<void> | null = null;

function loadBlockedSnapshot(): void {
  if (blockedSnapshotLoadTried) return;
  blockedSnapshotLoadTried = true;
  try {
    const raw = fs.readFileSync(BLOCKED_SNAPSHOT_PATH, 'utf8');
    const j = JSON.parse(raw) as BlockedSnapshot;
    if (Array.isArray(j?.ids)) blockedSnapshot = { ids: j.ids, at: Number(j.at) || 0 };
  } catch { /* snapshot yok */ }
}

function persistBlockedSnapshot(s: BlockedSnapshot): void {
  try {
    fs.mkdirSync(BLOCKED_CACHE_DIR, { recursive: true });
    fs.writeFileSync(BLOCKED_SNAPSHOT_PATH, JSON.stringify(s));
  } catch { /* disk yazılamazsa yalnız bellek */ }
}

/** Arka planda gerçek taramayı çalıştırır; tamamlanınca snapshot'ı ATOMİK günceller. */
function warmBlockedInBackground(): Promise<void> {
  if (blockedWarmPromise) return blockedWarmPromise;
  blockedWarmPromise = (async () => {
    try {
      const r = await getScan({}); // single-flight içeride korunur
      const state: BlockedSnapshot = { ids: r.products.map((p) => p.productId), at: Date.now() };
      blockedSnapshot = state;      // atomik swap
      persistBlockedSnapshot(state);
    } catch { /* arka plan hatası: mevcut snapshot korunur */ }
  })().finally(() => { blockedWarmPromise = null; });
  return blockedWarmPromise;
}

/**
 * RTS için güvenli blocked-set. ASLA gate taramasını bloke etmez.
 *  - snapshot varsa → hemen döner (stale ise arka planda tazeler).
 *  - snapshot yoksa → arka plan başlatır, `complete=false` döner (çağıran temkinli davranır).
 */
export async function getBlockedProductIdsSafe(): Promise<{ ids: string[]; complete: boolean }> {
  loadBlockedSnapshot();
  const snap = blockedSnapshot as BlockedSnapshot | null;
  if (snap) {
    if (Date.now() - snap.at > SCAN_TTL_MS) warmBlockedInBackground();
    return { ids: snap.ids, complete: true };
  }
  warmBlockedInBackground();
  return { ids: [], complete: false };
}

// Uygulama başlarken snapshot varsa yükle; yoksa arka planda ısıt (RTS'i bloke etmeden).
try {
  loadBlockedSnapshot();
  const snap = blockedSnapshot as BlockedSnapshot | null;
  if (!snap) warmBlockedInBackground();
  else if (Date.now() - snap.at > SCAN_TTL_MS) warmBlockedInBackground();
} catch { /* no-op */ }

/** Manuel/toplu çözüm sonrası yeniden hesaplamayı zorlar (snapshot'ı da arka planda tazeler). */
export function invalidateMissingFieldsCache(): void {
  scanCache = null;
  warmBlockedInBackground();
}

/** Katalog attribute cache'ini temizler (örn. katalog değişince). */
export function invalidateAttributeCatalogCache(): void {
  reqAttrCache.clear();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fold(s: string): string {
  return normalizeName(s);
}

async function getRequiredAttrs(catExt: number): Promise<ReqAttr[]> {
  const now = Date.now();
  const hit = reqAttrCache.get(catExt);
  if (hit && now - hit.at < CATALOG_TTL_MS) return hit.data;
  let data: ReqAttr[] = [];
  try {
    const defs = await fetchTrendyolCategoryAttributes(catExt);
    data = defs.filter((d) => d.required).map((d) => ({ id: d.attribute.id, name: d.attribute.name }));
  } catch {
    data = [];
  }
  reqAttrCache.set(catExt, { data, at: now });
  return data;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const width = Math.max(1, Math.min(limit, items.length || 1));
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Trendyol marketplace ID'sini bul. */
async function getTrendyolMarketplaceId(): Promise<string | null> {
  const m = await prisma.marketplace.findFirst({
    where: { key: 'tt', active: true },
    select: { id: true },
  });
  return m?.id ?? null;
}

/** Gate hata mesajından eksik attribute isimlerini ayıkla. */
function parseMissingNames(msg: string | null): string[] {
  if (!msg) return [];
  const m = /:\s*(.+)$/.exec(msg);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

// ─── Core Scan ──────────────────────────────────────────────────────────────

async function computeScan(opts: { xmlSourceId?: string }): Promise<ScanResult> {
  const marketplaceId = await getTrendyolMarketplaceId();
  const empty: ScanResult = {
    stats: { totalMissing: 0, autoResolved: 0, needsUser: 0, byField: {}, distinctAttributes: 0 },
    products: [],
    evaluated: 0,
    scannedAt: Date.now(),
  };
  if (!marketplaceId) return empty;

  const where: Record<string, unknown> = {
    status: { notIn: ['ACTIVE', 'SENDING', 'DELETED'] },
    categoryMatch: true,
    brandMatch: true,
    templateMatch: true,
    OR: [{ variantMatch: false }, { variantStatus: { not: 'NOT_REQUIRED' } }],
  };
  if (opts.xmlSourceId) where.xmlSourceId = opts.xmlSourceId;

  const candidates = await prisma.product.findMany({
    where,
    select: {
      id: true, title: true, sku: true, barcode: true, categoryId: true, xmlSourceId: true,
      brand: { select: { name: true, externalId: true } },
      variants: { select: { id: true } },
      marketplaceStates: { where: { marketplaceId }, select: { status: true } },
    },
    take: MAX_SCAN,
  });

  const mappings = await prisma.categoryMapping.findMany({
    where: { marketplaceId, active: true },
    select: { categoryId: true, externalId: true },
    orderBy: { createdAt: 'desc' },
  });
  const catExtMap = new Map<string, number>();
  for (const m of mappings) {
    if (!m.categoryId) continue;
    const n = Number(m.externalId);
    if (!catExtMap.has(m.categoryId) && Number.isInteger(n) && n > 0) catExtMap.set(m.categoryId, n);
  }

  const pre: Array<{ p: (typeof candidates)[number]; cat: number; hasVariants: boolean }> = [];
  for (const p of candidates) {
    if (!p.xmlSourceId || !p.categoryId) continue;
    const cat = catExtMap.get(p.categoryId);
    const brandExt = Number(p.brand?.externalId);
    if (!cat || !Number.isInteger(brandExt) || brandExt <= 0) continue;
    // Gerçek gönderim sürecindeki durumlar missing attribute SAYILMAZ.
    const pms = p.marketplaceStates[0]?.status;
    if (pms === 'SENDING' || pms === 'ACTIVE') continue;
    pre.push({ p, cat, hasVariants: p.variants.length > 0 });
  }

  const distinctCats = [...new Set(pre.map((x) => x.cat))];
  await mapLimit(distinctCats, 6, (c) => getRequiredAttrs(c));

  const persistedRows = pre.length
    ? await prisma.trendyolProductAttribute.findMany({
        where: { marketplaceKey: 'tt', productId: { in: pre.map((x) => x.p.id) } },
        select: { productId: true, categoryExternalId: true, attributeId: true, attributeValueId: true, attributeValue: true },
      })
    : [];
  const persisted = new Map<string, Map<number, { valueId: number | null; value: string | null }>>();
  for (const r of persistedRows) {
    const k = r.productId + '|' + r.categoryExternalId;
    if (!persisted.has(k)) persisted.set(k, new Map());
    persisted.get(k)!.set(r.attributeId, { valueId: r.attributeValueId, value: r.attributeValue });
  }

  const products: MissingFieldItem[] = [];
  const byField: Record<string, number> = {};
  const distinct = new Set<string>();
  let totalMissing = 0;

  for (const x of pre) {
    const reqs = reqAttrCache.get(x.cat)?.data ?? [];
    // Kategori attribute tanımı yoksa gate step-3 VARIANT_ATTRIBUTE_NOT_FOUND olur;
    // bu "eksik zorunlu alan" DEĞİLDİR → dahil etme.
    if (reqs.length === 0) continue;
    const have = persisted.get(x.p.id + '|' + x.cat) || new Map<number, { valueId: number | null; value: string | null }>();

    let missing: MissingFieldItem['missingAttributes'] = [];

    if (x.hasVariants) {
      // Gerçek gate — varyantlı ürünler için tek doğruluk kaynağı.
      const gate = await evaluateTrendyolSendGate({
        productId: x.p.id,
        marketplaceId,
        xmlSourceId: x.p.xmlSourceId!,
      });
      if (gate.firstFailureCode !== 'REQUIRED_ATTRIBUTE_MISSING') continue;
      const names = parseMissingNames(gate.firstFailureMessage);
      const byName = new Map(reqs.map((r) => [fold(r.name), r]));
      for (const n of names) {
        const def = byName.get(fold(n));
        const cur = def ? have.get(def.id) : undefined;
        missing.push({
          attributeId: def?.id ?? 0,
          attributeName: def?.name ?? n,
          currentValueId: cur?.valueId ?? null,
          currentValue: cur?.value ?? null,
          reason: 'XML varyantı Trendyol attribute/value whitelist ile eşleşmedi (gate step 3)',
        });
      }
      if (missing.length === 0) continue;
    } else {
      // Varyantsız — gate step-3 eşdeğeri (kanıtlanmış): required attribute'ın
      // kalıcı kaydı yoksa eksiktir.
      missing = reqs
        .filter((r) => !have.has(r.id))
        .map((r) => ({
          attributeId: r.id,
          attributeName: r.name,
          currentValueId: null,
          currentValue: null,
          reason: 'Zorunlu Trendyol alanı eksik (gate step 3)',
        }));
      if (missing.length === 0) continue;
    }

    products.push({
      productId: x.p.id,
      title: x.p.title,
      sku: x.p.sku,
      barcode: x.p.barcode,
      categoryId: x.p.categoryId,
      brandName: x.p.brand?.name ?? null,
      xmlSourceId: x.p.xmlSourceId,
      marketplaceId,
      marketplaceKey: 'tt',
      missingAttributes: missing,
      autoResolvedCount: 0,
      unresolvedCount: missing.length,
      status: 'NEEDS_USER',
    });
    totalMissing += missing.length;
    for (const m of missing) {
      byField[m.attributeName] = (byField[m.attributeName] || 0) + 1;
      distinct.add(m.attributeName);
    }
  }

  return {
    stats: {
      totalMissing,
      autoResolved: 0,
      needsUser: products.length,
      byField,
      distinctAttributes: distinct.size,
    },
    products,
    evaluated: pre.length,
    scannedAt: Date.now(),
  };
}

async function getScan(opts: { xmlSourceId?: string }): Promise<ScanResult> {
  const key = opts.xmlSourceId || '__all__';
  const now = Date.now();
  if (scanCache && scanCache.key === key && now - scanCache.at < SCAN_TTL_MS) {
    return scanCache.result;
  }
  // Concurrency: aynı key için eşzamanlı çağrılar tek taramayı paylaşır (duplicate iş yok).
  const existing = scanInFlight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const result = await computeScan(opts);
    scanCache = { key, at: Date.now(), result };
    return result;
  })().finally(() => {
    scanInFlight.delete(key);
  });
  scanInFlight.set(key, promise);
  return promise;
}

/**
 * Gerçek Trendyol send-gate/eşdeğeri ile `REQUIRED_ATTRIBUTE_MISSING` olan ürün ID'leri.
 * RTS (Gönderime Hazır) bu ürünleri dışlar. Cache miss'te hesaplanır (blocking) —
 * ürün yanlışlıkla "gönderilebilir" gösterilmez.
 */
export async function getBlockedProductIds(opts: { xmlSourceId?: string } = {}): Promise<string[]> {
  const r = await getScan({ xmlSourceId: opts.xmlSourceId });
  return r.products.map((p) => p.productId);
}

// ─── Public API (route sözleşmesi korunur) ──────────────────────────────────

/** Hızlı stats: gerçek gate/eşdeğer taramasından üretilir. */
export async function scanMissingFieldsQuick(opts: {
  xmlSourceId?: string;
  limit?: number;
}): Promise<MissingFieldsStats> {
  const r = await getScan({ xmlSourceId: opts.xmlSourceId });
  return r.stats;
}

/** Sayfalı liste: gerçek gate/eşdeğer taramasından üretilir. */
export async function scanMissingFields(opts: {
  useAI?: boolean;
  applyAutoResolve?: boolean;
  xmlSourceId?: string;
  limit?: number;
  page?: number;
}): Promise<{ stats: MissingFieldsStats; items: MissingFieldItem[] }> {
  const r = await getScan({ xmlSourceId: opts.xmlSourceId });
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(Math.max(1, opts.limit ?? 20), 100);
  const skip = (page - 1) * limit;
  const items = r.products.slice(skip, skip + limit).map((p) => ({ ...p }));
  return { stats: r.stats, items };
}

/**
 * Tek bir ürünün eksik zorunlu alanlarını analiz et ve (opsiyonel) otomatik çözüm dene.
 * Çözülemeyenleri döndürür.
 */
export async function analyzeAndTryResolve(
  productId: string,
  marketplaceId: string,
  xmlSourceId: string,
  opts: { useAI?: boolean; applyIfResolved?: boolean } = {}
): Promise<MissingFieldItem | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true, title: true, sku: true, barcode: true, categoryId: true,
      xmlSourceId: true, brand: { select: { name: true } },
    },
  });
  if (!product) return null;

  const gate = await evaluateTrendyolSendGate({ productId, marketplaceId, xmlSourceId });
  if (gate.firstFailureCode !== 'REQUIRED_ATTRIBUTE_MISSING') return null;

  const missingNames = parseMissingNames(gate.firstFailureMessage);
  if (missingNames.length === 0) return null;

  const proposal = await proposeForProduct(productId, marketplaceId, {
    useAI: opts.useAI ?? true,
    aiMinConfidence: 0.9,
  });

  let autoResolvedCount = 0;
  if (proposal.proposals.length > 0 && opts.applyIfResolved) {
    const result = await applyProposals(productId, proposal.proposals, 0.9);
    autoResolvedCount = result.applied;
    invalidateMissingFieldsCache();
  } else {
    autoResolvedCount = proposal.proposals.length;
  }

  const unresolved: MissingFieldItem['missingAttributes'] = [];
  const catExt = proposal.categoryExternalId;
  if (catExt) {
    const defs: ReqAttr[] = await getRequiredAttrs(catExt);
    for (const name of missingNames) {
      const def = defs.find((d) => fold(d.name) === fold(name));
      if (!def) {
        unresolved.push({ attributeId: 0, attributeName: name, currentValueId: null, currentValue: null, reason: 'Kategori attribute tanımı bulunamadı' });
        continue;
      }
      const resolved = proposal.proposals.find((p) => p.attributeId === def.id);
      if (resolved) continue;
      const existing = await prisma.trendyolProductAttribute.findUnique({
        where: {
          productId_marketplaceKey_categoryExternalId_attributeId: {
            productId, marketplaceKey: 'tt', categoryExternalId: catExt, attributeId: def.id,
          },
        },
        select: { attributeValueId: true, attributeValue: true },
      }).catch(() => null);
      unresolved.push({
        attributeId: def.id,
        attributeName: def.name,
        currentValueId: existing?.attributeValueId ?? null,
        currentValue: existing?.attributeValue ?? null,
        reason: existing ? 'Mevcut değer geçersiz/kayıpsız' : 'Otomatik eşleşme başarısız',
      });
    }
  }

  if (unresolved.length === 0 && autoResolvedCount > 0) {
    return {
      productId, title: product.title, sku: product.sku, barcode: product.barcode,
      categoryId: product.categoryId, brandName: product.brand?.name ?? null,
      xmlSourceId: product.xmlSourceId, marketplaceId, marketplaceKey: 'tt',
      missingAttributes: [], autoResolvedCount, unresolvedCount: 0, status: 'AUTO_RESOLVED',
    };
  }

  return {
    productId, title: product.title, sku: product.sku, barcode: product.barcode,
    categoryId: product.categoryId, brandName: product.brand?.name ?? null,
    xmlSourceId: product.xmlSourceId, marketplaceId, marketplaceKey: 'tt',
    missingAttributes: unresolved, autoResolvedCount, unresolvedCount: unresolved.length,
    status: unresolved.length > 0 ? 'NEEDS_USER' : 'AUTO_RESOLVED',
  };
}

/**
 * Kullanıcı manuel eşleştirme: attribute value'yu DB'ye yaz,
 * eligibility yeniden hesapla, çözüldüyse otomatik çıkar.
 */
export async function resolveManually(
  productId: string,
  marketplaceId: string,
  attributeId: number,
  valueId: number,
  value: string,
  categoryExternalId: number
): Promise<ResolveResult> {
  const details: string[] = [];

  const vals = await fetchTrendyolAttributeValues(categoryExternalId, attributeId, 300).catch(() => [] as Array<{ attributeValueId: number; attributeValue: string }>);
  const valid = vals.find((v) => Number(v.attributeValueId) === valueId);
  if (!valid) {
    return { ok: false, applied: 0, skipped: 1, newlyReady: false, details: [], error: `valueId ${valueId} katalogda bulunamadı` };
  }

  await prisma.trendyolProductAttribute.upsert({
    where: {
      productId_marketplaceKey_categoryExternalId_attributeId: {
        productId, marketplaceKey: 'tt', categoryExternalId, attributeId,
      },
    },
    update: { attributeValueId: valueId, attributeValue: valid.attributeValue, source: 'manual', confidence: 1.0 },
    create: {
      productId, marketplaceKey: 'tt', categoryExternalId, attributeId,
      attributeName: valid.attributeValue, attributeValueId: valueId, attributeValue: valid.attributeValue,
      source: 'manual', confidence: 1.0,
    },
  });
  details.push(`OK: attributeId=${attributeId} → ${valid.attributeValue} (valueId=${valueId})`);

  await prisma.auditLog.create({
    data: {
      action: 'MISSING_FIELD_MANUAL_RESOLVE',
      entity: 'product',
      entityId: productId,
      details: `Manual attribute resolve: ${valid.attributeValue}`,
      meta: JSON.stringify({ productId, attributeId, valueId, value: valid.attributeValue, categoryExternalId, at: new Date().toISOString() }),
    },
  }).catch(() => null);

  const xmlSourceId = (await prisma.product.findUnique({ where: { id: productId }, select: { xmlSourceId: true } }))?.xmlSourceId;
  if (!xmlSourceId) return { ok: true, applied: 1, skipped: 0, newlyReady: false, details };

  const gate = await evaluateTrendyolSendGate({ productId, marketplaceId, xmlSourceId });
  // Manuel işlem sonrası tarama cache'i GEÇERSİZ kılınır → yeniden hesaplanır.
  invalidateMissingFieldsCache();
  return { ok: true, applied: 1, skipped: 0, newlyReady: gate.ok, details };
}

/**
 * Toplu otomatik çözüm: tüm eksik ürünleri bul ve çöz.
 */
export async function batchAutoResolve(opts: {
  useAI?: boolean;
  xmlSourceId?: string;
  limit?: number;
}): Promise<{ stats: MissingFieldsStats; resolved: number; failed: number }> {
  const marketplaceId = await getTrendyolMarketplaceId();
  if (!marketplaceId) {
    return { stats: { totalMissing: 0, autoResolved: 0, needsUser: 0, byField: {}, distinctAttributes: 0 }, resolved: 0, failed: 0 };
  }

  const where: Record<string, unknown> = {
    status: { notIn: ['ACTIVE', 'SENDING', 'DELETED'] },
    categoryMatch: true,
    brandMatch: true,
    templateMatch: true,
  };
  if (opts.xmlSourceId) where.xmlSourceId = opts.xmlSourceId;

  const products = await prisma.product.findMany({
    where,
    select: { id: true, xmlSourceId: true },
    take: opts.limit ?? 200,
  });

  let resolved = 0;
  let failed = 0;
  const byField: Record<string, number> = {};

  for (const p of products) {
    if (!p.xmlSourceId) continue;
    try {
      const item = await analyzeAndTryResolve(p.id, marketplaceId, p.xmlSourceId, {
        useAI: opts.useAI ?? true,
        applyIfResolved: true,
      });
      if (!item) continue;
      if (item.status === 'AUTO_RESOLVED') resolved++;
      else for (const m of item.missingAttributes) byField[m.attributeName] = (byField[m.attributeName] || 0) + 1;
    } catch {
      failed++;
    }
  }

  invalidateMissingFieldsCache();
  return {
    stats: {
      totalMissing: resolved + Object.values(byField).reduce((a, b) => a + b, 0),
      autoResolved: resolved,
      needsUser: Object.values(byField).reduce((a, b) => a + b, 0),
      byField,
    },
    resolved,
    failed,
  };
}

// ─── AUTO-RESOLVE (gerçek çözüm + metrik) ───────────────────────────────────
// Önce DETERMINISTIK (AI'sız), sonra (istenirse) FREE-ONLY AI. Yalnız
// katalog-doğrulanmış + grounded + confidence>=0.9 öneriler otomatik yazılır.
// Ürün/kategori/marka/fiyat/stok/varyant DEĞİŞTİRİLMEZ; sadece attribute eşleşmesi.
export interface AutoResolveMetrics {
  baselineProducts: number;
  baselineMissing: number;
  processed: number;
  deterministic: number;
  ai: number;
  unresolved: number;
  rejected: number;
  errors: number;
  remainingProducts: number;
  remainingMissing: number;
  batches: number;
  aiProcessed?: string[]; // AI PASS'te denenmiş ürün ID'leri (kalıcı cache; DB'ye yazılmaz)
  aiBatchIds?: string[];  // bu çalıştırmada AI PASS'e giren ürün ID'leri
  lastAt: number;
}

const AUTORESOLVE_PATH = path.join(BLOCKED_CACHE_DIR, 'missing-fields-autoresolve.json');
let autoResolveMetrics: AutoResolveMetrics | null = null;

export function getAutoResolveMetrics(): AutoResolveMetrics | null {
  if (autoResolveMetrics) return autoResolveMetrics;
  try { autoResolveMetrics = JSON.parse(fs.readFileSync(AUTORESOLVE_PATH, 'utf8')) as AutoResolveMetrics; } catch { autoResolveMetrics = null; }
  return autoResolveMetrics;
}

export async function autoResolveMissingFields(opts: { useAI?: boolean; maxProducts?: number; batchSize?: number; waitMs?: number } = {}): Promise<AutoResolveMetrics> {
  const marketplaceId = await getTrendyolMarketplaceId();
  const before = await getScan({});
  const prev = getAutoResolveMetrics();
  let runDet = 0, runAi = 0, runProcessed = 0, runUnresolved = 0, runRejected = 0, runErrors = 0;
  const m: AutoResolveMetrics = {
    baselineProducts: Math.max(prev?.baselineProducts ?? 0, before.stats.needsUser),
    baselineMissing: Math.max(prev?.baselineMissing ?? 0, before.stats.totalMissing),
    processed: 0, deterministic: 0, ai: 0, unresolved: 0, rejected: 0, errors: 0,
    remainingProducts: before.stats.needsUser, remainingMissing: before.stats.totalMissing,
    batches: 0, lastAt: Date.now(),
  };
  if (!marketplaceId) { autoResolveMetrics = { ...m, deterministic: prev?.deterministic ?? 0, ai: prev?.ai ?? 0 }; return autoResolveMetrics; }

  const useAI = !!opts.useAI;
  const maxProducts = Math.min(Math.max(1, opts.maxProducts ?? 60), 1200);
  const batchSize = Math.min(Math.max(1, opts.batchSize ?? 15), 50);
  const waitMs = Math.max(0, opts.waitMs ?? 1200);
  const AI_CALL_TIMEOUT_MS = 30000;
  // AI PASS cursor: yalnız bu sürücüde DAHA ÖNCE denenmemiş ürünler seçilir.
  // Deterministik (useAI=false) seçim DEĞİŞMEZ (slice(0, maxProducts)).
  const processedSet = new Set<string>(prev?.aiProcessed || []);
  const aiBatchIds: string[] = [];
  const list = useAI
    ? before.products.filter((p) => !processedSet.has(p.productId)).slice(0, maxProducts)
    : before.products.slice(0, maxProducts);

  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize);
    await mapLimit(batch, Math.min(batchSize, 5), async (it) => {
      if (useAI) { aiBatchIds.push(it.productId); processedSet.add(it.productId); }
      if (!it.xmlSourceId) { runErrors++; return; }
      try {
        const gate = await evaluateTrendyolSendGate({ productId: it.productId, marketplaceId, xmlSourceId: it.xmlSourceId });
        if (gate.firstFailureCode !== 'REQUIRED_ATTRIBUTE_MISSING') return;
        let proposal;
        try {
          proposal = await Promise.race([
            proposeForProduct(it.productId, marketplaceId, { useAI, aiMinConfidence: 0.9 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_CALL_TIMEOUT_MS))
          ]);
        } catch {
          runErrors++;
          return;
        }
        runProcessed++;
        if (proposal.proposals.length === 0) { runUnresolved++; return; }
        const det = proposal.proposals.filter((p) => p.source !== 'AI');
        const ai = proposal.proposals.filter((p) => p.source === 'AI');
        const res = await applyProposals(it.productId, proposal.proposals, 0.9);
        const detApplied = Math.max(0, Math.min(det.length, res.applied));
        runDet += detApplied;
        runAi += Math.max(0, Math.min(ai.length, res.applied - detApplied));
        runRejected += res.skipped;
      } catch { runErrors++; }
    });
    m.batches++;
    if (i + batchSize < list.length && waitMs) await new Promise((r) => setTimeout(r, waitMs));
  }

  invalidateMissingFieldsCache();
  const after = await getScan({});
  m.processed = runProcessed;
  m.deterministic = (prev?.deterministic ?? 0) + runDet; // KÜMÜLATİF (önceki çözümler korunur)
  m.ai = (prev?.ai ?? 0) + runAi;
  m.unresolved = runUnresolved;
  m.rejected = runRejected;
  m.errors = runErrors;
  m.remainingProducts = after.stats.needsUser;
  m.remainingMissing = after.stats.totalMissing;
  m.aiProcessed = [...processedSet];
  m.aiBatchIds = aiBatchIds;
  m.lastAt = Date.now();
  autoResolveMetrics = m;
  try { fs.mkdirSync(BLOCKED_CACHE_DIR, { recursive: true }); fs.writeFileSync(AUTORESOLVE_PATH, JSON.stringify(m)); } catch { /* no-op */ }
  return m;
}
