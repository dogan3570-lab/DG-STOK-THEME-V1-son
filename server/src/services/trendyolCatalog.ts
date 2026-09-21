import { prisma } from '../db/prisma.ts';
import { decryptCredential } from './crypto.ts';

/**
 * TRENDYOL CATALOG CLIENT — yalnızca resmi READ-ONLY GET endpoint'leri.
 * Credential yalnızca istek anında decrypt edilir; değer ASLA loglanmaz/dönmez.
 * Sahte ID üretilmez; yalnızca gerçek API response'u döner.
 */
const BASE = 'https://apigw.trendyol.com/integration';

// GÜVENLİ TTL CACHE: aynı kategori/attribute için tekrar API çağrısı yapılmaz.
// Yalnızca başarılı ve boş-olmayan yanıtlar cache'lenir; TTL sonunda tazelenir.
const CATALOG_CACHE_TTL_MS = 30 * 60 * 1000;
const attrDefsCache = new Map<number, { json: TrendyolCategoryAttribute[]; at: number }>();
const attrValuesCache = new Map<string, { json: TrendyolAttributeValue[]; at: number }>();

export interface TrendyolCategory {
  id: number;
  name: string;
  parentId: number | null;
  subCategories: TrendyolCategory[];
}

export interface TrendyolBrand {
  id: number;
  name: string;
  luxe: boolean;
}

export interface TrendyolCategoryAttribute {
  allowCustom: boolean;
  attribute: { id: number; name: string };
  categoryId: number;
  required: boolean;
  varianter: boolean;
  slicer: boolean;
  allowMultipleAttributeValues: boolean;
}

export interface TrendyolAttributeValue {
  attributeValueId: number;
  attributeValue: string;
}

interface CatalogCredentials {
  apiKey: string;
  apiSecret: string;
  sellerId: string;
}

async function getCredentials(): Promise<CatalogCredentials | null> {
  const mp = await prisma.marketplace.findUnique({ where: { key: 'tt' } });
  if (!mp) return null;
  const apiKey = mp.apiKey ? decryptCredential(mp.apiKey) : null;
  const apiSecret = mp.apiSecret ? decryptCredential(mp.apiSecret) : null;
  let sellerId: string | null = null;
  try {
    const s = JSON.parse(mp.settings || '{}');
    if (typeof s.sellerId === 'string' && s.sellerId.trim()) sellerId = s.sellerId.trim();
  } catch { /* bozuk settings */ }
  if (!apiKey || !apiSecret || !sellerId) return null;
  return { apiKey, apiSecret, sellerId };
}

async function catalogGet(path: string): Promise<{ status: number; ok: boolean; json: unknown; raw: string }> {
  const cred = await getCredentials();
  if (!cred) return { status: 0, ok: false, json: null, raw: 'CREDENTIAL_MISSING' };
  const headers = {
    Authorization: 'Basic ' + Buffer.from(`${cred.apiKey}:${cred.apiSecret}`).toString('base64'),
    'User-Agent': `${cred.sellerId} - SelfIntegration`,
    Accept: 'application/json',
  };
  try {
    const res = await fetch(`${BASE}${path}`, { headers, redirect: 'error' });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* parse hatası */ }
    return { status: res.status, ok: res.ok, json, raw: text.slice(0, 200) };
  } catch (e) {
    return { status: 0, ok: false, json: null, raw: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

export async function fetchTrendyolCategoryTree(): Promise<TrendyolCategory[]> {
  const r = await catalogGet('/product/product-categories');
  if (!r.ok || !r.json) return [];
  const j = r.json as Record<string, unknown>;
  const arr = Array.isArray(j) ? j : (j.categories || j.content || []);
  return Array.isArray(arr) ? (arr as TrendyolCategory[]) : [];
}

export async function fetchTrendyolBrands(page = 0, size = 1000): Promise<TrendyolBrand[]> {
  const r = await catalogGet(`/product/brands?page=${page}&size=${size}`);
  if (!r.ok || !r.json) return [];
  const j = r.json as Record<string, unknown>;
  const arr = j.brands || j.content || (Array.isArray(j) ? j : []);
  return Array.isArray(arr) ? (arr as TrendyolBrand[]) : [];
}

export async function fetchTrendyolCategoryAttributes(categoryId: number): Promise<TrendyolCategoryAttribute[]> {
  const now = Date.now();
  const hit = attrDefsCache.get(categoryId);
  if (hit && now - hit.at < CATALOG_CACHE_TTL_MS) return hit.json;
  const r = await catalogGet(`/product/categories/${categoryId}/attributes`);
  if (!r.ok || !r.json) return [];
  const j = r.json as Record<string, unknown>;
  const arr = j.categoryAttributes || j.content || (Array.isArray(j) ? j : []);
  const out = Array.isArray(arr) ? (arr as TrendyolCategoryAttribute[]) : [];
  // Yalnızca başarılı/boş-olmayan yanıt cache'lenir (transient hata kalıcılaşmasın).
  if (out.length > 0) attrDefsCache.set(categoryId, { json: out, at: now });
  return out;
}

export async function fetchTrendyolAttributeValues(categoryId: number, attributeId: number, size = 1000): Promise<TrendyolAttributeValue[]> {
  const key = categoryId + ':' + attributeId;
  const now = Date.now();
  const hit = attrValuesCache.get(key);
  if (hit && now - hit.at < CATALOG_CACHE_TTL_MS) return hit.json;
  const r = await catalogGet(`/product/categories/${categoryId}/attributes/${attributeId}/values?size=${size}`);
  if (!r.ok || !r.json) return [];
  const j = r.json as Record<string, unknown>;
  const arr = j.content || (Array.isArray(j) ? j : []);
  const out = Array.isArray(arr) ? (arr as TrendyolAttributeValue[]) : [];
  if (out.length > 0) attrValuesCache.set(key, { json: out, at: now });
  return out;
}

/** Katalog cache'ini temizler (katalog değişiminde manuel çağrılabilir). */
export function invalidateTrendyolCatalogCache(): void {
  attrDefsCache.clear();
  attrValuesCache.clear();
}
