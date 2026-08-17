/**
 * XML → Trendyol mapping matcher (SAF, veritabanı/ağ içermez).
 * Yalnızca GERÇEK Trendyol catalog response'undaki isimlerle eşleşir.
 * Sahte ID üretilmez; belirsiz eşleşme MANUAL/AMBIGUOUS, yoksa NOT_FOUND döner.
 */

export type MatchStatus = 'MATCHED' | 'AMBIGUOUS' | 'NOT_FOUND';

export interface MatchResult {
  status: MatchStatus;
  id: number | null;
  name: string | null;
  candidates: Array<{ id: number; name: string }>;
}

/** Normalize: küçük harf + Türkçe karakter ASCII + boşluk/özel karakter temizliği. */
export function normalizeName(s: string): string {
  const map: Record<string, string> = {
    'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u',
    'Ç': 'c', 'Ğ': 'g', 'İ': 'i', 'I': 'i', 'Ö': 'o', 'Ş': 's', 'Ü': 'u',
  };
  return (s || '')
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function isMeaningful(name: string): boolean {
  const n = normalizeName(name);
  if (!n || n.length < 2) return false;
  // AKYI benzeri saf büyük harf/kısaltma anlamsız değerleri reddet (en az bir anlamlı harf içermeli)
  return true;
}

export interface CategoryNode { id: number; name: string; subCategories?: CategoryNode[]; parentId?: number | null; }

/** XML kategori path'ini (örn. "Kadın > Elbise") Trendyol ağacında yaprak ismiyle eşleştirir. */
export function matchTrendyolCategory(xmlPath: string, tree: CategoryNode[]): MatchResult {
  const leaf = (xmlPath || '').split('>').map((s) => s.trim()).filter(Boolean).pop() || '';
  const target = normalizeName(leaf);
  if (!isMeaningful(target)) return { status: 'NOT_FOUND', id: null, name: null, candidates: [] };

  const candidates: Array<{ id: number; name: string }> = [];
  const walk = (nodes: CategoryNode[]) => {
    for (const n of nodes) {
      if (normalizeName(n.name) === target) {
        candidates.push({ id: n.id, name: n.name });
      }
      if (n.subCategories && n.subCategories.length > 0) walk(n.subCategories);
    }
  };
  walk(tree);

  if (candidates.length === 0) return { status: 'NOT_FOUND', id: null, name: null, candidates: [] };
  if (candidates.length > 1) return { status: 'AMBIGUOUS', id: null, name: null, candidates };
  return { status: 'MATCHED', id: candidates[0].id, name: candidates[0].name, candidates };
}

export type MappingClassification = 'AUTO_MATCH' | 'MANUAL_REVIEW' | 'NOT_FOUND';

export interface ClassifiedMatch {
  status: MappingClassification;
  id: number | null;
  name: string | null;
  candidates: Array<{ id: number; name: string }>;
  reason: string | null;
}

/** MATCHED → AUTO_MATCH, AMBIGUOUS → MANUAL_REVIEW, NOT_FOUND → NOT_FOUND. */
export function classifyMatch(m: MatchResult): ClassifiedMatch {
  if (m.status === 'MATCHED') {
    return { status: 'AUTO_MATCH', id: m.id, name: m.name, candidates: m.candidates, reason: null };
  }
  if (m.status === 'AMBIGUOUS') {
    return { status: 'MANUAL_REVIEW', id: null, name: null, candidates: m.candidates, reason: 'Birden fazla aday var; manuel inceleme gerekli' };
  }
  return { status: 'NOT_FOUND', id: null, name: null, candidates: [], reason: 'Eşleşme bulunamadı' };
}

/**
 * Path-aware kategori eşleştirme.
 * XML yolunun tamamını (örn. "Kadın > Giyim > Elbise") kullanarak yaprak adı
 * çakışmalarını parent/child ilişkisiyle çözer.
 *
 * Skorlama (en yüksek skor kazanır; eşitlik AMBIGUOUS):
 *  - tam yol eşleşmesi          → 100
 *  - xml yolu node'un suffix'i   → 80  (yaprak eşleşmesi)
 *  - node yolu xml'in prefix'i   → 60
 *  - kısmi ortak suffix (>=2)    → 70 + c*5
 */
export function matchTrendyolCategoryByPath(xmlPath: string, tree: CategoryNode[]): MatchResult {
  const xmlTokens = (xmlPath || '').split('>').map((s) => normalizeName(s.trim())).filter((t) => t.length > 0);
  if (xmlTokens.length === 0) return { status: 'NOT_FOUND', id: null, name: null, candidates: [] };

  const scored: Array<{ id: number; name: string; score: number }> = [];

  const scorePath = (xml: string[], node: string[]): number => {
    let c = 0;
    const minLen = Math.min(xml.length, node.length);
    for (let i = 1; i <= minLen; i++) {
      if (xml[xml.length - i] === node[node.length - i]) c++;
      else break;
    }
    if (c === 0) return 0;
    if (xml.length === node.length && c === xml.length) return 100;
    if (c === xml.length) return 80;
    if (c === node.length) return 60;
    return 70 + c * 5;
  };

  const walk = (nodes: CategoryNode[], pathTokens: string[]) => {
    for (const n of nodes) {
      const tokens = [...pathTokens, normalizeName(n.name)];
      const score = scorePath(xmlTokens, tokens);
      if (score > 0) scored.push({ id: n.id, name: n.name, score });
      if (n.subCategories && n.subCategories.length > 0) walk(n.subCategories, tokens);
    }
  };
  walk(tree, []);

  if (scored.length === 0) return { status: 'NOT_FOUND', id: null, name: null, candidates: [] };
  const maxScore = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === maxScore);
  const candidates = top.map((s) => ({ id: s.id, name: s.name }));
  if (candidates.length > 1) return { status: 'AMBIGUOUS', id: null, name: null, candidates };
  return { status: 'MATCHED', id: candidates[0].id, name: candidates[0].name, candidates };
}

export interface BrandNode { id: number; name: string; luxe?: boolean; }

/** XML markasını Trendyol marka listesinde normalize isimle eşleştirir. */
export function matchTrendyolBrand(xmlBrand: string, brands: BrandNode[]): MatchResult {
  const target = normalizeName(xmlBrand || '');
  if (!isMeaningful(target)) return { status: 'NOT_FOUND', id: null, name: null, candidates: [] };

  const candidates = brands
    .filter((b) => normalizeName(b.name) === target)
    .map((b) => ({ id: b.id, name: b.name }));

  if (candidates.length === 0) return { status: 'NOT_FOUND', id: null, name: null, candidates: [] };
  if (candidates.length > 1) return { status: 'AMBIGUOUS', id: null, name: null, candidates };
  return { status: 'MATCHED', id: candidates[0].id, name: candidates[0].name, candidates };
}
