import { prisma } from '../db/prisma.ts';
import { decryptCredential } from './crypto.ts';

/**
 * TRENDYOL CATALOG CLIENT — yalnızca resmi READ-ONLY GET endpoint'leri.
 * Credential yalnızca istek anında decrypt edilir; değer ASLA loglanmaz/dönmez.
 * Sahte ID üretilmez; yalnızca gerçek API response'u döner.
 */
const BASE = 'https://apigw.trendyol.com/integration';

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
  const r = await catalogGet(`/product/categories/${categoryId}/attributes`);
  if (!r.ok || !r.json) return [];
  const j = r.json as Record<string, unknown>;
  const arr = j.categoryAttributes || j.content || (Array.isArray(j) ? j : []);
  return Array.isArray(arr) ? (arr as TrendyolCategoryAttribute[]) : [];
}

export async function fetchTrendyolAttributeValues(categoryId: number, attributeId: number, size = 1000): Promise<TrendyolAttributeValue[]> {
  const r = await catalogGet(`/product/categories/${categoryId}/attributes/${attributeId}/values?size=${size}`);
  if (!r.ok || !r.json) return [];
  const j = r.json as Record<string, unknown>;
  const arr = j.content || (Array.isArray(j) ? j : []);
  return Array.isArray(arr) ? (arr as TrendyolAttributeValue[]) : [];
}
