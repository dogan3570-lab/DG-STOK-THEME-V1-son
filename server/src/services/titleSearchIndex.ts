import { prisma } from '../db/prisma.ts';

/**
 * TITLE SEARCH INDEX — 2M+ ölçek için bellek içi title arama.
 *
 * LIKE '%search%' (Prisma contains) 2M satırda ~40s sürüyor çünkü SQLite
 * tam tablo taraması yapıyor. Bu servis tüm title'ları belleğe yükler
 * ve String.includes() ile filtreler — O(n) ama bellek içi, ~50-100ms.
 *
 * bellek tüketimi: ~2M ürün × ~120 bytes ≈ 240MB (tolerans dahilinde)
 *
 * Cache invalidation: ürün ekleme/güncelleme/silme sonrası手动 çağrılır.
 * Otomatik invalidation yerine manuel tercih edildi — performans için.
 */

type IndexEntry = { id: string; titleLower: string };

let _index: IndexEntry[] | null = null;
let _loading = false;
let _loadPromise: Promise<IndexEntry[]> | null = null;
let _loadedAt = 0;

const RELOAD_INTERVAL = 300_000; // 5 dakika otomatik reload (son güvenlik ağı)

async function loadIndex(): Promise<IndexEntry[]> {
  if (_index && Date.now() - _loadedAt < RELOAD_INTERVAL) return _index;
  if (_loadPromise) return _loadPromise;

  _loading = true;
  _loadPromise = (async () => {
    const t0 = Date.now();
    const entries: IndexEntry[] = [];
    const BATCH = 10_000;
    let cursor: string | undefined;

    while (true) {
      const batch = await prisma.product.findMany({
        where: cursor ? { id: { gt: cursor } } : undefined,
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true, title: true },
      });
      if (batch.length === 0) break;
      for (const p of batch) {
        entries.push({ id: p.id, titleLower: (p.title ?? '').toLowerCase() });
      }
      cursor = batch[batch.length - 1].id;
      if (batch.length < BATCH) break;
    }

    _index = entries;
    _loadedAt = Date.now();
    _loading = false;
    _loadPromise = null;
    console.log(`[titleSearchIndex] loaded ${entries.length} entries in ${Date.now() - t0}ms`);
    return entries;
  })();

  return _loadPromise;
}

/**
 * Title alaninda substring aramasi yapar (LIKE '%search%' ile birebir ayni sonuc).
 * Case-insensitive: SQLite LIKE zaten case-insensitive (ASCII), burada da toLowerCase() kullanilir.
 *
 * @returns eslesen product ID'leri
 */
export async function searchByTitle(search: string): Promise<string[]> {
  const index = await loadIndex();
  const needle = search.toLowerCase();
  const matches: string[] = [];
  for (const entry of index) {
    if (entry.titleLower.includes(needle)) {
      matches.push(entry.id);
    }
  }
  return matches;
}

/**
 * Index'i invalidate eder ve yeniden yukler.
 * Import, reconcile, urun ekleme/guncelleme/silme sonrasi cagrilir.
 */
export async function invalidateTitleIndex(): Promise<void> {
  _index = null;
  _loadedAt = 0;
  _loadPromise = null;
  await loadIndex();
}

/**
 * Index'in yuklenip yuklenmedigini kontrol eder (startup icin).
 */
export async function ensureTitleIndex(): Promise<void> {
  await loadIndex();
}

/**
 * Index istatistikleri (monitoring icin).
 */
export function getTitleIndexStats(): { size: number; loaded: boolean; age: number } {
  return {
    size: _index?.length ?? 0,
    loaded: _index !== null,
    age: _index ? Date.now() - _loadedAt : 0,
  };
}
