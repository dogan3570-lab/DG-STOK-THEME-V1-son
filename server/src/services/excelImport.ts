// TASK314: Excel/CSV toplu ürün importu — preview (yazmasız doğrulama) + commit (upsert).
// Identity: buildProductKey('EXCEL', ...) — aynı dosya tekrar yüklenirse UPDATE olur, duplicate oluşmaz.
// Tombstone: status='DELETED' ürünler asla canlandırılmaz.
import { prisma } from '../db/prisma.ts';
import { parseXlsx, parseCsvText } from './xlsxLite.ts';
import { createManualOrExcelProduct, PRODUCT_STATUS_DELETED } from './productLifecycle.ts';
import { invalidateProductsStats } from './productsStatsCache.ts';

const MAX_ROWS = 5000;

const COL_ALIASES: Record<string, string[]> = {
  title: ['urun adi', 'ürün adı', 'urun adi*', 'ürün ad', 'urun', 'baslik', 'başlık', 'title', 'ad', 'name', 'product name'],
  barcode: ['barkod', 'barkod no', 'barcode', 'ean'],
  sku: ['sku', 'stok kodu', 'stokkodu', 'stok kod', 'urun kodu', 'ürün kodu', 'code'],
  brand: ['marka', 'brand'],
  category: ['kategori', 'category', 'tedarikçi kategorisi', 'tedarikci kategorisi'],
  stock: ['stok', 'adet', 'stock', 'miktar', 'quantity', 'qty'],
  purchasePrice: ['alış fiyatı', 'alis fiyati', 'alış', 'alis', 'purchase price', 'purchase', 'maliyet'],
  salePrice: ['satış fiyatı', 'satis fiyati', 'satış', 'satis', 'fiyat', 'sale price', 'sale', 'price'],
  description: ['açıklama', 'aciklama', 'description', 'detay'],
};

function normalizeHeader(h: string): string {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function mapHeaders(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    const n = normalizeHeader(h);
    for (const [field, aliases] of Object.entries(COL_ALIASES)) {
      if (!map[field] && aliases.includes(n)) map[field] = h;
    }
  }
  return map;
}

export interface ImportRowResult {
  rowNumber: number;
  title: string;
  status: 'valid' | 'invalid' | 'duplicate_file' | 'duplicate_db';
  reason?: string;
}

export interface PreviewResult {
  ok: true;
  fileName: string;
  fileType: 'xlsx' | 'csv';
  headers: string[];
  mappedColumns: Record<string, string>;
  missingRequired: string[];
  totalRows: number;
  validRows: number;
  invalidRows: Array<{ rowNumber: number; reason: string }>;
  duplicateInFile: Array<{ rowNumber: number; key: string }>;
  existsInDb: number;
  deletedTombstone: number;
  sample: Array<Record<string, string>>;
}

export interface CommitResult {
  ok: true;
  fileName: string;
  created: number;
  updated: number;
  skippedDeleted: number;
  duplicatesInFile: number;
  failed: number;
  errors: Array<{ rowNumber?: number; reason: string }>;
}

function decodeBase64ToFile(b64: string): { buf: Buffer; ext: 'xlsx' | 'csv'; name: string } {
  const idx = b64.indexOf(';base64,');
  let meta = '';
  let dataPart = b64;
  if (idx >= 0) {
    meta = b64.slice(0, idx);
    dataPart = b64.slice(idx + ';base64,'.length);
  }
  const buf = Buffer.from(dataPart, 'base64');
  if (buf.length === 0) throw new Error('Dosya boş');
  if (buf.length > 20 * 1024 * 1024) throw new Error('Dosya çok büyük (maks 20MB)');
  const nameM = meta.match(/name="?([^\";]+)"?/i);
  const name = nameM ? decodeURIComponent(nameM[1]) : 'upload';
  const ext = /\.csv$/i.test(name) ? 'csv' : /\.xlsx$/i.test(name) ? 'xlsx' : (/^data:text\/csv/i.test(meta) ? 'csv' : 'xlsx');
  return { buf, ext, name };
}

function toRows(buf: Buffer, ext: 'xlsx' | 'csv'): { headers: string[]; rows: Array<Record<string, string>> } {
  if (ext === 'csv') return parseCsvText(buf.toString('utf8'));
  return parseXlsx(buf);
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN as unknown as number;
  return Number(s);
}

interface PreparedRow {
  rowNumber: number;
  input: Parameters<typeof createManualOrExcelProduct>[0];
  key: string;
  errors: string[];
}

function prepareRow(rowNumber: number, raw: Record<string, string>, colMap: Record<string, string>): PreparedRow {
  const get = (f: string) => (colMap[f] ? (raw[colMap[f]] ?? '').trim() : '');
  const errors: string[] = [];
  const title = get('title');
  if (!title) errors.push('Ürün adı boş');
  else if (title.length > 500) errors.push('Ürün adı 500 karakterden uzun');

  const stockRaw = num(get('stock') || '0');
  if (Number.isNaN(stockRaw)) errors.push(`Stok sayısal değil: "${get('stock')}"`);
  const pRaw = num(get('purchasePrice'));
  if (get('purchasePrice') && Number.isNaN(pRaw)) errors.push(`Alış fiyatı sayısal değil: "${get('purchasePrice')}"`);
  const sRaw = num(get('salePrice'));
  if (get('salePrice') && Number.isNaN(sRaw)) errors.push(`Satış fiyatı sayısal değil: "${get('salePrice')}"`);

  const barcode = get('barcode') || null;
  const sku = get('sku') || null;
  // Identity: barkod > sku > başlık hash'i
  const crypto = require('node:crypto');
  const keyBase = barcode || sku || 'T-' + crypto.createHash('sha1').update(title.toLowerCase()).digest('hex').slice(0, 16);
  return {
    rowNumber,
    errors,
    key: String(keyBase).toUpperCase(),
    input: {
      title,
      sku,
      barcode,
      brand: get('brand') || null,
      category: get('category') || null,
      stock: stockRaw != null ? Math.trunc(stockRaw) : 0,
      purchasePrice: pRaw != null && !Number.isNaN(pRaw) ? pRaw : null,
      salePrice: sRaw != null && !Number.isNaN(sRaw) ? sRaw : null,
      vatRate: null,
      description: get('description') || null,
      source: 'EXCEL',
    },
  };
}

/** Aynı dosyada tekrarlanan identity anahtarlarını işaretle */
function markFileDuplicates(prepared: PreparedRow[]): Set<number> {
  const seen = new Map<string, number>();
  const dups = new Set<number>();
  for (const r of prepared) {
    if (seen.has(r.key)) dups.add(r.rowNumber);
    else seen.set(r.key, r.rowNumber);
  }
  return dups;
}

export async function previewImport(base64File: string): Promise<PreviewResult | { ok: false; error: { code: string; message: string } }> {
  let file: { buf: Buffer; ext: 'xlsx' | 'csv'; name: string };
  try {
    file = decodeBase64ToFile(base64File);
  } catch (e) {
    return { ok: false, error: { code: 'FILE_DECODE_ERROR', message: e instanceof Error ? e.message : 'Dosya okunamadı' } };
  }
  let parsed: { headers: string[]; rows: Array<Record<string, string>> };
  try {
    parsed = toRows(file.buf, file.ext);
  } catch (e) {
    return { ok: false, error: { code: 'PARSE_ERROR', message: e instanceof Error ? e.message : 'Dosya çözümlenemedi (bozuk Excel?)' } };
  }
  const colMap = mapHeaders(parsed.headers);
  const missingRequired = colMap.title ? [] : ['title'];
  if (parsed.rows.length > MAX_ROWS) {
    return { ok: false, error: { code: 'TOO_MANY_ROWS', message: `Maks ${MAX_ROWS} satır yüklenebilir (gelen: ${parsed.rows.length})` } };
  }

  const prepared: PreparedRow[] = [];
  const invalidRows: Array<{ rowNumber: number; reason: string }> = [];
  let rowNo = 1; // header = satır 1
  for (const raw of parsed.rows) {
    rowNo++;
    const allEmpty = Object.values(raw).every(v => !String(v).trim());
    if (allEmpty) continue; // boş satır sessizce atlanır
    const p = prepareRow(rowNo, raw, colMap);
    if (p.errors.length) invalidRows.push({ rowNumber: rowNo, reason: p.errors.join(' · ') });
    else prepared.push(p);
  }
  const dupSet = markFileDuplicates(prepared);

  // DB'de varlık kontrolü (tek seferde IN sorgusu)
  const keys = [...new Set(prepared.map(p => 'EXCEL:' + p.key))];
  const existing = keys.length
    ? await prisma.product.findMany({ where: { xmlKey: { in: keys } }, select: { xmlKey: true, status: true } })
    : [];
  const existMap = new Map(existing.map(e => [e.xmlKey, e.status]));
  let existsInDb = 0;
  let deletedTombstone = 0;
  for (const k of keys) {
    const st = existMap.get(k);
    if (st && st !== PRODUCT_STATUS_DELETED) existsInDb++;
    if (st === PRODUCT_STATUS_DELETED) deletedTombstone++;
  }

  return {
    ok: true,
    fileName: file.name,
    fileType: file.ext,
    headers: parsed.headers,
    mappedColumns: colMap,
    missingRequired,
    totalRows: prepared.length + invalidRows.length,
    validRows: prepared.length - dupSet.size,
    invalidRows,
    duplicateInFile: [...dupSet].map(n => ({ rowNumber: n, key: prepared.find(p => dupSet.has(n))?.key ?? '' })),
    existsInDb,
    deletedTombstone,
    sample: parsed.rows.slice(0, 5),
  };
}

export async function commitImport(rows: Array<Record<string, string>>, fileName: string, colMapOverride?: Record<string, string>): Promise<CommitResult | { ok: false; error: { code: string; message: string } }> {
  if (!Array.isArray(rows)) return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'rows array zorunlu' } };
  if (rows.length > MAX_ROWS) return { ok: false, error: { code: 'TOO_MANY_ROWS', message: `Maks ${MAX_ROWS} satır` } };

  // Server-side kolon eşleme (istemciye güvenilmez)
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const colMap = colMapOverride && colMapOverride.title ? colMapOverride : mapHeaders(headers);
  if (!colMap.title) return { ok: false, error: { code: 'MISSING_COLUMN', message: '"Ürün Adı" kolonu bulunamadı. Gerekli kolon: Ürün Adı. Opsiyonel: Barkod, SKU, Marka, Kategori, Stok, Alış Fiyatı, Satış Fiyatı, Açıklama' } };

  const result: CommitResult = { ok: true, fileName: fileName || 'upload', created: 0, updated: 0, skippedDeleted: 0, duplicatesInFile: 0, failed: 0, errors: [] };
  const seenKeys = new Set<string>();
  let rowNo = 1;
  for (const raw of rows) {
    rowNo++;
    const allEmpty = Object.values(raw ?? {}).every(v => !String(v ?? '').trim());
    if (allEmpty) continue;
    const p = prepareRow(rowNo, raw, colMap);
    if (p.errors.length) { result.failed++; result.errors.push({ rowNumber: rowNo, reason: p.errors.join(' · ') }); continue; }
    if (seenKeys.has(p.key)) { result.duplicatesInFile++; continue; }
    seenKeys.add(p.key);

    // Tombstone kontrolü: silinmiş ürün canlandırılamaz
    const xmlKey = 'EXCEL:' + p.key;
    const existing = await prisma.product.findUnique({ where: { xmlKey }, select: { id: true, status: true } });
    if (existing && existing.status === PRODUCT_STATUS_DELETED) { result.skippedDeleted++; continue; }

    try {
      const wasExisting = !!existing;
      const res = await createManualOrExcelProduct({ ...p.input, source: 'EXCEL' });
      if (res.ok) {
        if (wasExisting) result.updated++;
        else result.created++;
      } else if ((res.body as { error?: { code?: string } }).error?.code === 'DUPLICATE') {
        // yarış durumu: bu anahtar commit içinde zaten oluşturuldu → güncelleme say
        result.updated++;
      } else {
        result.failed++;
        result.errors.push({ rowNumber: rowNo, reason: String((res.body as { error?: { message?: string } }).error?.message ?? 'Bilinmeyen hata') });
      }
    } catch (e) {
      result.failed++;
      result.errors.push({ rowNumber: rowNo, reason: e instanceof Error ? e.message.slice(0, 200) : 'İşlem hatası' });
    }
  }
  invalidateProductsStats();
  return result;
}


// Wrapper: base64 file → decode → parse → commitImport
export async function commitImportFile(base64File: string, colMapOverride?: Record<string, string>): Promise<CommitResult | { ok: false; error: { code: string; message: string } }> {
  let file: { buf: Buffer; ext: 'xlsx' | 'csv'; name: string };
  try {
    file = decodeBase64ToFile(base64File);
  } catch (e) {
    return { ok: false, error: { code: 'FILE_DECODE_ERROR', message: e instanceof Error ? e.message : 'Dosya okunamadı' } };
  }
  let parsed: { headers: string[]; rows: Array<Record<string, string>> };
  try {
    parsed = toRows(file.buf, file.ext);
  } catch (e) {
    return { ok: false, error: { code: 'PARSE_ERROR', message: e instanceof Error ? e.message : 'Dosya çözümlenemedi (bozuk Excel?)' } };
  }
  return commitImport(parsed.rows, file.name, colMapOverride);
}
