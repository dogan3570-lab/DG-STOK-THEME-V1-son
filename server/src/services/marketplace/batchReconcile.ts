/**
 * Trendyol ASYNC batch reconciliation — SALT-OKUNUR marketplace sorgusu.
 *
 * Kök neden: SEND yanıtı yalnızca `batchRequestId` döner; PMS 'SENDING' yazılır.
 * Trendyol batch'i SONRADAN FAILED/failureReasons ile sonuçlandırır ama bu sonuç
 * okunmuyordu → ürünler SENDING'de kalıp "Pazaryerine Gitmeyen"e düşmüyordu.
 *
 * Bu servis yalnızca `GET .../products/batch-requests/{batchRequestId}` çağırır
 * (ürün GÖNDERMEZ). FAILED ise PMS'i ERROR'a çevirir; PROCESSING/PENDING ise dokunmaz;
 * başarılıysa mevcut SENDING akışı korunur (sahte ACTIVE üretilmez).
 */
import { prisma } from '../../db/prisma.ts';
import { getMarketplaceWithCredentials } from './marketplaceApi.ts';
import { requestWithBoundedRetry } from './httpClient.ts';
import { trendyolBaseUrl, basicAuth } from './adapters.ts';

export interface BatchStatusResult {
  httpStatus: number | null;
  batchStatus: string | null;
  failureReasons: string[];
  error?: string;
}

export async function getTrendyolBatchStatus(marketplaceId: string, batchRequestId: string): Promise<BatchStatusResult> {
  const { mp, cred } = await getMarketplaceWithCredentials(marketplaceId);
  if (!mp || !cred) return { httpStatus: null, batchStatus: null, failureReasons: [], error: 'MARKETPLACE_NOT_FOUND' };
  if (!mp.apiUrl) return { httpStatus: null, batchStatus: null, failureReasons: [], error: 'NOT_CONFIGURED' };
  const sellerId = String(cred.sellerId ?? '').trim();
  if (!sellerId) return { httpStatus: null, batchStatus: null, failureReasons: [], error: 'NO_SELLER_ID' };

  const url = `${trendyolBaseUrl(mp.apiUrl)}/product/sellers/${sellerId}/products/batch-requests/${encodeURIComponent(batchRequestId)}`;
  try {
    const res = await requestWithBoundedRetry(url, {
      method: 'GET',
      headers: {
        Authorization: basicAuth(cred.apiKey ?? '', cred.apiSecret ?? ''),
        'User-Agent': `${sellerId} - SelfIntegration`,
      },
    });
    if (res.status < 200 || res.status >= 300) {
      return { httpStatus: res.status, batchStatus: null, failureReasons: [], error: `HTTP_${res.status}` };
    }
    let data: any = {};
    try { data = JSON.parse(res.body); } catch { return { httpStatus: res.status, batchStatus: null, failureReasons: [], error: 'PARSE_ERROR' }; }
    const root = data?.data ?? data;
    const batch = Array.isArray(root?.items) ? root.items[0] : root;
    const batchStatus = String(batch?.status ?? root?.status ?? '').toUpperCase() || null;
    const failureReasons: string[] = [];
    const collect = (arr: any) => { if (Array.isArray(arr)) for (const x of arr) { const s = typeof x === 'string' ? x : (x?.reason || x?.message); if (s && String(s).trim()) failureReasons.push(String(s).trim()); } };
    collect(batch?.failureReasons);
    if (Array.isArray(batch?.items)) {
      for (const it of batch.items) {
        collect(it?.failureReasons);
        if (String(it?.status ?? '').toUpperCase() === 'FAILED') collect([it?.failureReason]);
      }
    }
    return { httpStatus: res.status, batchStatus, failureReasons };
  } catch (e: any) {
    return { httpStatus: null, batchStatus: null, failureReasons: [], error: e?.message || 'NETWORK_ERROR' };
  }
}

export interface BatchReconcileSummary {
  scanned: number;
  failed: number;
  stillPending: number;
  errors: number;
  details: Array<{ productId: string; marketplaceId: string; batchRequestId: string; batchStatus: string | null; action: 'ERROR' | 'KEEP' | 'SKIP'; message?: string }>;
}

/**
 * PMS `status='SENDING'` + externalRef (batchRequestId) kayıtlarını Trendyol'dan
 * salt-okunur doğrular. FAILED → PMS ERROR. Diğer durumlar KORUNUR.
 */
export async function reconcileTrendyolBatchStatuses(limit = 100): Promise<BatchReconcileSummary> {
  const summary: BatchReconcileSummary = { scanned: 0, failed: 0, stillPending: 0, errors: 0, details: [] };
  const tt = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
  if (!tt) return summary;

  const stuck = await prisma.productMarketplaceState.findMany({
    where: { marketplaceId: tt.id, status: 'SENDING', externalRef: { not: null } },
    select: { id: true, productId: true, marketplaceId: true, externalRef: true },
    take: Math.max(1, Math.min(500, limit)),
  });

  for (const s of stuck) {
    summary.scanned++;
    const batchRequestId = String(s.externalRef);
    const res = await getTrendyolBatchStatus(s.marketplaceId, batchRequestId);

    if (res.error && !res.batchStatus) {
      summary.errors++;
      summary.details.push({ productId: s.productId, marketplaceId: s.marketplaceId, batchRequestId, batchStatus: null, action: 'SKIP', message: res.error });
      continue;
    }

    const isFailed = res.batchStatus === 'FAILED' || res.failureReasons.length > 0;
    if (isFailed) {
      const msg = res.failureReasons.length > 0 ? res.failureReasons.join('; ') : `Trendyol batch status: ${res.batchStatus}`;
      await prisma.productMarketplaceState.update({
        where: { id: s.id },
        data: { status: 'ERROR', errorMessage: `TRENDYOL_BATCH_FAILED: ${msg}`.slice(0, 500), lastActionAt: new Date() },
      });
      summary.failed++;
      summary.details.push({ productId: s.productId, marketplaceId: s.marketplaceId, batchRequestId, batchStatus: res.batchStatus, action: 'ERROR', message: msg.slice(0, 120) });
    } else {
      summary.stillPending++;
      summary.details.push({ productId: s.productId, marketplaceId: s.marketplaceId, batchRequestId, batchStatus: res.batchStatus, action: 'KEEP' });
    }
  }
  return summary;
}
