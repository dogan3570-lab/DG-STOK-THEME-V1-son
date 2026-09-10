import { prisma } from '../../db/prisma.ts';
import { decryptCredential } from '../crypto.ts';
import { requestWithBoundedRetry } from './httpClient.ts';

/**
 * Trendyol Order Sync — GERÇEK Trendyol API'den sipariş çeker.
 *
 * GET /integration/orders?startDate=...&endDate=...&page=0&size=100
 * upsert by orderNo (unique) — duplicate oluşturmaz.
 *
 * Security: credential loglanmaz, raw body loglanmaz.
 */

interface TrendyolOrderCustomer {
  id?: number;
  name?: string;
  surname?: string;
  email?: string;
  phone?: string;
}

interface TrendyolOrderLineItem {
  id?: number;
  barcode?: string;
  sku?: string;
  productName?: string;
  quantity?: number;
  price?: number;
  vatBaseAmount?: number;
  amount?: number;
  status?: string;
  stockLocationId?: number;
}

interface TrendyolOrder {
  id?: number;
  orderNumber?: string;
  orderDate?: string;
  status?: string;
  totalDiscountedPrice?: number;
  totalPrice?: number;
  taxIncludedPrice?: number;
  customer?: TrendyolOrderCustomer;
  shipmentAddress?: {
    fullName?: string;
    city?: string;
    district?: string;
    fullAddress?: string;
  };
  lineItems?: TrendyolOrderLineItem[];
}

interface TrendyolOrderResponse {
  status?: number;
  data?: {
    content?: TrendyolOrder[];
    totalPages?: number;
    totalElements?: number;
    numberOfElements?: number;
  };
}

function mapTrendyolStatus(status: string | undefined): string {
  switch (status) {
    case 'Created': return 'new';
    case 'Accepted': return 'processing';
    case 'Shipped': return 'shipped';
    case 'Delivered': return 'delivered';
    case 'Cancelled': return 'cancelled';
    case 'Returned': return 'returned';
    default: return 'new';
  }
}

function maskPhone(phone: string | undefined): string {
  if (!phone) return '';
  if (phone.length < 7) return '•••';
  return phone.substring(0, 3) + '•••' + phone.substring(phone.length - 2);
}

export interface OrderSyncResult {
  ok: boolean;
  fetched: number;
  created: number;
  updated: number;
  duplicate: number;
  error: string | null;
  latencyMs: number;
  httpStatus: number | null;
}

export async function syncTrendyolOrders(marketplaceId: string, options?: {
  startDate?: string;
  endDate?: string;
  page?: number;
  size?: number;
}): Promise<OrderSyncResult> {
  const start = Date.now();

  const mp = await prisma.marketplace.findUnique({
    where: { id: marketplaceId },
    select: { id: true, key: true, name: true, active: true, apiUrl: true, apiKey: true, apiSecret: true, settings: true },
  });

  if (!mp || mp.key !== 'tt') {
    return { ok: false, fetched: 0, created: 0, updated: 0, duplicate: 0, error: 'Marketplace not found or not Trendyol', latencyMs: Date.now() - start, httpStatus: null };
  }

  if (!mp.apiKey || !mp.apiSecret) {
    return { ok: false, fetched: 0, created: 0, updated: 0, duplicate: 0, error: 'NOT_CONFIGURED — API Key / API Secret tanımlı değil', latencyMs: Date.now() - start, httpStatus: null };
  }

  const settings = mp.settings ? JSON.parse(mp.settings) : {};
  const sellerId = typeof settings.sellerId === 'string' ? settings.sellerId : null;
  if (!sellerId) {
    return { ok: false, fetched: 0, created: 0, updated: 0, duplicate: 0, error: 'Seller ID tanımlı değil', latencyMs: Date.now() - start, httpStatus: null };
  }

  const apiKey = decryptCredential(mp.apiKey);
  const apiSecret = decryptCredential(mp.apiSecret);
  if (!apiKey || !apiSecret) {
    return { ok: false, fetched: 0, created: 0, updated: 0, duplicate: 0, error: 'Credential decrypt başarısız', latencyMs: Date.now() - start, httpStatus: null };
  }

  const TRENDYOL_BASE = /stage/i.test(mp.apiUrl || '') ? 'https://stageapigw.trendyol.com/integration' : 'https://apigw.trendyol.com/integration';

  const endDate = options?.endDate || new Date().toISOString().split('T')[0];
  const startDate = options?.startDate || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  })();
  const page = options?.page ?? 0;
  const size = options?.size ?? 100;

  const url = `${TRENDYOL_BASE}/orders?startDate=${startDate}&endDate=${endDate}&page=${page}&size=${size}`;
  const auth = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

  let httpStatus: number | null = null;
  try {
    const response = await requestWithBoundedRetry(url, {
      method: 'GET',
      headers: {
        'Authorization': auth,
        'User-Agent': `${sellerId} - SelfIntegration`,
        'Content-Type': 'application/json',
      },
    }, (err, attempt) => {
      console.log(`[order-sync] retry attempt=${attempt} code=${err.code}`);
    });

    httpStatus = response.status;

    if (response.status !== 200) {
      const msg = response.status === 401 ? 'Kimlik bilgileri geçersiz (401)'
        : response.status === 403 ? 'Yetki yok (403)'
        : response.status === 429 ? 'Rate limit aşıldı (429)'
        : `API yanıt vermedi (${response.status})`;
      return { ok: false, fetched: 0, created: 0, updated: 0, duplicate: 0, error: msg, latencyMs: Date.now() - start, httpStatus };
    }

    const parsed: TrendyolOrderResponse = JSON.parse(response.body);
    const orders = parsed.data?.content ?? [];
    const fetched = orders.length;

    let created = 0;
    let updated = 0;
    let duplicate = 0;

    for (const order of orders) {
      if (!order.orderNumber) { duplicate++; continue; }

      const orderNo = String(order.orderNumber);
      const status = mapTrendyolStatus(order.status);
      const customerName = [order.customer?.name, order.customer?.surname].filter(Boolean).join(' ') || 'Bilinmeyen';
      const customerEmail = order.customer?.email || null;
      const customerPhone = maskPhone(order.customer?.phone || undefined);
      const total = order.taxIncludedPrice ?? order.totalPrice ?? order.totalDiscountedPrice ?? 0;

      const existing = await prisma.order.findUnique({
        where: { orderNo },
        select: { id: true, status: true },
      });

      if (existing) {
        // Mevcut sipariş — yalnızca status değiştiyse güncelle
        if (existing.status !== status) {
          await prisma.order.update({
            where: { orderNo },
            data: { status, updatedAt: new Date() },
          });
          updated++;
        } else {
          duplicate++;
        }
      } else {
        await prisma.order.create({
          data: {
            orderNo,
            channel: 'Trendyol',
            marketplaceId: mp.id,
            customerName,
            customerEmail,
            customerPhone,
            status,
            total,
          },
        });
        created++;
      }
    }

    console.log(`[order-sync] Trendyol: fetched=${fetched} created=${created} updated=${updated} duplicate=${duplicate} latencyMs=${Date.now() - start}`);

    return {
      ok: true,
      fetched,
      created,
      updated,
      duplicate,
      error: null,
      latencyMs: Date.now() - start,
      httpStatus,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg.includes('TIMEOUT')) {
      return { ok: false, fetched: 0, created: 0, updated: 0, duplicate: 0, error: 'Zaman aşımı', latencyMs: Date.now() - start, httpStatus };
    }
    if (msg.includes('SSRF_BLOCKED')) {
      return { ok: false, fetched: 0, created: 0, updated: 0, duplicate: 0, error: 'SSRF engeli', latencyMs: Date.now() - start, httpStatus };
    }
    return { ok: false, fetched: 0, created: 0, updated: 0, duplicate: 0, error: msg, latencyMs: Date.now() - start, httpStatus };
  }
}
