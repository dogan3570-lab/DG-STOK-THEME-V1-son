/**
 * TAXONOMY FAMILY RESOLVER — Tek merkezî canonical family çözümleyici.
 *
 * AMAC: Dağınık/elle büyüyen ROOT_FAMILY_MAP mantığını merkezî hale getirmek.
 *  - Tek normalizasyon (Türkçe/ASCII, büyük-küçük harf, &/ve, boşluk, noktalama).
 *  - Supplier path ve TT fullPath AYNI resolver'dan geçer → aynı canonical family.
 *  - Bilinen synonym kök grupları (ör. 'Hırdavat' ≡ 'Banyo Yapı & Hırdavat').
 *  - Bilinmeyen kök → SELF-CANONICAL (normalize edilmiş kök adı). Böylece yeni
 *    TT/supplier kategori geldiğinde KODA map satırı eklemek GEREKMEZ (kural 8).
 *  - Boş/belirsiz kök → UNRESOLVED_FAMILY (güvenlik kapısını bypass ETMEZ; kural 6/7).
 *
 * Deterministik; DB/ağ/LLM bağımlılığı yok. SafetyGate bu modülü kullanır.
 */

import { normalizeName } from './categoryBrandMapper.ts';

/** Belirsiz/bilinmeyen (boş) kök için fallback. Güvenlik kapısı bunu PASS saymaz. */
export const UNRESOLVED_FAMILY = 'UNRESOLVED_FAMILY';

/**
 * Canonical family synonym grupları. Bir grup içindeki tüm kökler AYNI family'dir.
 * İlk eleman canonical id'dir (normalize edilir). Bu grup YALNIZCA metinsel olarak
 * farklı ama anlamsal olarak aynı kökler içindir; benzer yazımlar (ör. 'Banyo Yapi
 * & Hirdavat') zaten normalize sayesinde otomatik eşleşir, gruba eklenmesi gerekmez.
 */
const FAMILY_SYNONYM_GROUPS: string[][] = [
  ['Elektronik'],
  ['Banyo Yapı & Hırdavat', 'Hırdavat'],
  ['Otomobil & Motosiklet'],
  ['Kozmetik & Kişisel Bakım'],
  ['Spor & Outdoor'],
  ['Ev & Mobilya', 'Ev Dekorasyon', 'Mutfak ve Elektrikli Aletler'],
  ['Aksesuar'],
  ['Anne & Bebek & Çocuk'],
  ['Oyuncak'],
  ['Bahçe & Elektrikli El Aletleri'],
  ['Süpermarket'],
  ['Kırtasiye & Ofis Malzemeleri'],
  ['Fotoğraf & Kamera'],
  ['Oyun & Konsol'],
  ['Güvenlik Sistemleri'],
  ['Petshop'],
  ['Sağlık'],
];

/**
 * Kök token normalizasyonu — tek nokta.
 * normalizeName'e ek olarak ayraç olarak kullanılan tek başına "ve" token'ını kaldırır
 * ('Banyo Yapı ve Hırdavat' → 'Banyo Yapı Hırdavat'), böylece '&' ile aynı sonucu verir.
 */
export function normalizeRootToken(root: string): string {
  return normalizeName(String(root).replace(/(^|\s)ve(\s|$)/gi, ' '));
}

const ALIAS_TO_CANON: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const group of FAMILY_SYNONYM_GROUPS) {
    const canon = normalizeRootToken(group[0]);
    for (const alias of group) m.set(normalizeRootToken(alias), canon);
  }
  return m;
})();

/**
 * Path'ten ilk segmenti (kök) alır. '>' ve '>>>' ayraçlarını destekler.
 * Örnek: 'Elektronik > Elektrikli Ev Aletleri > Süpürge' → 'Elektronik'
 */
export function getTaxonomyRoot(fullPath: string): string {
  const segments = String(fullPath ?? '').split('>').map((s) => s.trim()).filter(Boolean);
  return segments.length > 0 ? segments[0] : '';
}

/**
 * Kökten canonical family çözer. Bilinen synonym → canonical id; bilinmeyen → self-canonical;
 * boş/belirsiz → UNRESOLVED_FAMILY.
 */
export function resolveFamilyFromRoot(root: string | null | undefined): string {
  const token = normalizeRootToken(root ?? '');
  if (!token) return UNRESOLVED_FAMILY;
  return ALIAS_TO_CANON.get(token) ?? token;
}

/** Supplier Category path'inden canonical family. */
export function resolveSupplierFamily(supplierCategory: string | null | undefined): string {
  return resolveFamilyFromRoot(getTaxonomyRoot(supplierCategory ?? ''));
}

/** TT fullPath'ten canonical family. TT family ASLA leaf Category.name'den hesaplanmaz. */
export function resolveTrendyolFamily(trendyolFullPath: string | null | undefined): string {
  return resolveFamilyFromRoot(getTaxonomyRoot(trendyolFullPath ?? ''));
}

export function isUnresolvedFamily(family: string): boolean {
  return family === UNRESOLVED_FAMILY;
}
