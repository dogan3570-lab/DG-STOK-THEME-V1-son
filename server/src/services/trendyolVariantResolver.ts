/**
 * TRENDYOL VARIANT / ATTRIBUTE RESOLVER — SAF (DB/AĞ İÇERMEZ).
 *
 * XML varyantlarını (örn. Renk=Siyah) yalnızca GERÇEK Trendyol kategori
 * attribute ve attribute-value response'larıyla eşleştirir.
 *
 * KESİN KURALLAR:
 *  - Whitelist yoksa EŞLEŞME OLMAZ (AKYI gibi bozuk değerler asla auto kabul edilmez).
 *  - allowCustom=true olsa bile bu fazda CUSTOM string değer ÜRETİLMEZ.
 *  - Sahte attributeId/attributeValueId ÜRETİLMEZ.
 *  - Eşleşme belirsizse (birden fazla aday) AMBIGUOUS döner.
 */
import { normalizeName } from './categoryBrandMapper.ts';

export interface TrendyolAttributeDef {
  attribute: { id: number; name: string };
  categoryId: number;
  required: boolean;
  varianter: boolean;
  slicer: boolean;
  allowCustom: boolean;
}

export interface TrendyolAttributeValueDef {
  attributeValueId: number;
  attributeValue: string;
}

export interface XmlVariant {
  name: string;
  value: string;
}

export type VariantAttrStatus = 'MATCHED' | 'AMBIGUOUS' | 'NOT_FOUND' | 'INVALID_VALUE';

export interface TrendyolPayloadAttribute {
  attributeId: number;
  attributeValueIds?: number[];
  attributeValue?: string;
}

export interface ResolvedTrendyolAttribute {
  status: VariantAttrStatus;
  attributeId: number | null;
  attributeName: string | null;
  attributeValueId: number | null;
  attributeValue: string | null;
  xmlVariantName: string;
  xmlVariantValue: string;
  candidates: Array<{ attributeId: number; attributeName: string; attributeValueId: number; attributeValue: string }>;
}

export interface TrendyolAttributeResolution {
  status: 'OK' | 'VARIANT_ATTRIBUTE_NOT_FOUND' | 'REQUIRED_ATTRIBUTE_MISSING';
  /** Trendyol V2 payload formatı: attributeValueIds[] (whitelist) — custom string YOK. */
  attributes: TrendyolPayloadAttribute[];
  resolved: ResolvedTrendyolAttribute[];
  missing: Array<{ xmlVariantName: string; xmlVariantValue: string; reason: string }>;
  requiredMissing: Array<{ attributeId: number; attributeName: string }>;
}

/**
 * AKYI benzeri boş/anlamsız değerleri reddet (whitelist asıl korumadır).
 * Tek harfli bedenler (M/L/S) GEÇERLİDİR; asıl koruma whitelist eşleşmesidir.
 */
export function isMeaningfulVariantValue(value: string): boolean {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  const n = normalizeName(raw);
  if (!n) return false;
  // Tamamen noktalama/rakam olmayan çöp değerler (örn. "---", "12") reddedilir.
  if (!/[a-z]/.test(n)) return false;
  return true;
}

function emptyResolution(): TrendyolAttributeResolution {
  return { status: 'OK', attributes: [], resolved: [], missing: [], requiredMissing: [] };
}

function collectCandidates(
  attrs: TrendyolAttributeDef[],
  valuesByAttribute: Map<number, TrendyolAttributeValueDef[]>,
  nameFilter: (attrNameNorm: string) => boolean,
  valueNorm: string
): Array<{ attributeId: number; attributeName: string; attributeValueId: number; attributeValue: string }> {
  const out: Array<{ attributeId: number; attributeName: string; attributeValueId: number; attributeValue: string }> = [];
  for (const attr of attrs) {
    const attrNameNorm = normalizeName(attr.attribute.name);
    if (!nameFilter(attrNameNorm)) continue;
    const values = valuesByAttribute.get(attr.attribute.id) ?? [];
    for (const v of values) {
      if (normalizeName(v.attributeValue) === valueNorm) {
        out.push({ attributeId: attr.attribute.id, attributeName: attr.attribute.name, attributeValueId: v.attributeValueId, attributeValue: v.attributeValue });
        break; // her attribute için tek değer yeterli
      }
    }
  }
  return out;
}

export function matchVariantToTrendyolAttribute(
  variant: XmlVariant,
  attrs: TrendyolAttributeDef[],
  valuesByAttribute: Map<number, TrendyolAttributeValueDef[]>
): ResolvedTrendyolAttribute {
  const xmlVariantName = String(variant.name ?? '').trim();
  const xmlVariantValue = String(variant.value ?? '').trim();

  if (!isMeaningfulVariantValue(xmlVariantValue)) {
    return { status: 'INVALID_VALUE', attributeId: null, attributeName: null, attributeValueId: null, attributeValue: null, xmlVariantName, xmlVariantValue, candidates: [] };
  }

  const valueNorm = normalizeName(xmlVariantValue);
  const nameNorm = normalizeName(xmlVariantName);

  const pick = (candidates: Array<{ attributeId: number; attributeName: string; attributeValueId: number; attributeValue: string }>): ResolvedTrendyolAttribute => {
    if (candidates.length === 1) {
      const c = candidates[0];
      return { status: 'MATCHED', attributeId: c.attributeId, attributeName: c.attributeName, attributeValueId: c.attributeValueId, attributeValue: c.attributeValue, xmlVariantName, xmlVariantValue, candidates };
    }
    if (candidates.length > 1) {
      return { status: 'AMBIGUOUS', attributeId: null, attributeName: null, attributeValueId: null, attributeValue: null, xmlVariantName, xmlVariantValue, candidates };
    }
    return { status: 'NOT_FOUND', attributeId: null, attributeName: null, attributeValueId: null, attributeValue: null, xmlVariantName, xmlVariantValue, candidates: [] };
  };

  // 1) Tam attribute adı eşleşmesi + whitelist value
  const exact = collectCandidates(attrs, valuesByAttribute, (a) => a === nameNorm, valueNorm);
  if (exact.length > 0) return pick(exact);

  // 2) İsim içeriyor / içeriliyor (örn. "Renk" → "Kordon Renk")
  if (nameNorm.length >= 3) {
    const contains = collectCandidates(attrs, valuesByAttribute, (a) => a.includes(nameNorm) || (a.length >= 3 && nameNorm.includes(a)), valueNorm);
    if (contains.length > 0) return pick(contains);
  }

  // 2b) allowCustom=true: whitelist value YOKSA bile XML değeri CUSTOM olarak kabul edilir (valueId ÜRETİLMEZ).
  //     Yalnızca varyant adı attribute adıyla gerçekten eşleşiyorsa (belirsizlik olmadan) kabul edilir.
  const customAttr = attrs.find((a) => {
    if (!(a.varianter || a.slicer) || !a.allowCustom) return false;
    const an = normalizeName(a.attribute.name);
    return an === nameNorm || (nameNorm.length >= 3 && an.includes(nameNorm)) || (an.length >= 3 && nameNorm.includes(an));
  });
  if (customAttr) {
    return {
      status: 'MATCHED',
      attributeId: customAttr.attribute.id,
      attributeName: customAttr.attribute.name,
      attributeValueId: null,
      attributeValue: xmlVariantValue,
      xmlVariantName,
      xmlVariantValue,
      candidates: [],
    };
  }

  // 3) Yalnızca value eşleşmesi (attribute adı bilinmiyor)
  const valueOnly = collectCandidates(attrs, valuesByAttribute, () => true, valueNorm);
  return pick(valueOnly);
}

/**
 * XML varyantlarını Trendyol attribute/value setine eşler ve gerekli
 * varianter attribute'ların kapsandığını doğrular.
 *
 * valuesByAttribute: yalnızca varianter/slicer attribute'ların gerçek value listeleri.
 */
export function resolveTrendyolAttributes(
  attrs: TrendyolAttributeDef[],
  valuesByAttribute: Map<number, TrendyolAttributeValueDef[]>,
  variants: XmlVariant[],
  persistedAttributes: TrendyolPayloadAttribute[] = []
): TrendyolAttributeResolution {
  if (!Array.isArray(attrs) || attrs.length === 0) {
    // Kategori attribute response'u yoksa doğrulama YAPILAMAZ (fail-closed).
    return { status: 'VARIANT_ATTRIBUTE_NOT_FOUND', attributes: [], resolved: [], missing: [{ xmlVariantName: '', xmlVariantValue: '', reason: 'KATEGORI_ATTRIBUTE_YOK' }], requiredMissing: [] };
  }

  const persisted = Array.isArray(persistedAttributes) ? persistedAttributes : [];
  const persistedIds = new Set<number>(persisted.map((p) => p.attributeId));

  const variantList = Array.isArray(variants) ? variants : [];
  if (variantList.length === 0) {
    // Varyant yok: zorunlu (required) attribute varsa EKSİK kabul edilir (fail-closed).
    // KALICI Trendyol kayıtları (persistedAttributes) ile karşılananlar eksik SAYILMAZ.
    const requiredMissing = attrs
      .filter((a) => a.required && !persistedIds.has(a.attribute.id))
      .map((a) => ({ attributeId: a.attribute.id, attributeName: a.attribute.name }));
    if (requiredMissing.length > 0) {
      return { status: 'REQUIRED_ATTRIBUTE_MISSING', attributes: persisted, resolved: [], missing: [], requiredMissing };
    }
    if (persisted.length === 0) return emptyResolution();
    return { status: 'OK', attributes: persisted, resolved: [], missing: [], requiredMissing: [] };
  }

  const resolved: ResolvedTrendyolAttribute[] = [];
  const missing: TrendyolAttributeResolution['missing'] = [];

  for (const variant of variantList) {
    const r = matchVariantToTrendyolAttribute(variant, attrs, valuesByAttribute);
    resolved.push(r);
    if (r.status === 'INVALID_VALUE') {
      missing.push({ xmlVariantName: variant.name, xmlVariantValue: variant.value, reason: 'INVALID_VALUE (AKYI/bozuk değer)' });
    } else if (r.status === 'AMBIGUOUS') {
      missing.push({ xmlVariantName: variant.name, xmlVariantValue: variant.value, reason: 'AMBIGUOUS (birden fazla aday)' });
    } else if (r.status === 'NOT_FOUND') {
      missing.push({ xmlVariantName: variant.name, xmlVariantValue: variant.value, reason: 'NOT_FOUND (whitelist değer yok)' });
    }
  }

  const payloadAttributes: TrendyolPayloadAttribute[] = resolved
    .filter((r) => r.status === 'MATCHED' && r.attributeId !== null)
    .map((r) => {
      if (r.attributeValueId !== null) {
        return { attributeId: r.attributeId as number, attributeValueIds: [r.attributeValueId] };
      }
      return { attributeId: r.attributeId as number, attributeValue: r.attributeValue ?? undefined };
    });

  // Zorunlu (required) attribute'ların TAMAMI payload'da bulunmalıdır — yalnızca
  // varianter olanlar değil. Aksi halde Trendyol batch'i FAILED döner (fail-closed).
  const presentAttrIds = new Set<number>(payloadAttributes.map((a) => a.attributeId));
  // KALICI Trendyol kayıtlarını payload'a ekle (aynı attributeId zaten varsa dokunma).
  for (const p of persisted) {
    if (!presentAttrIds.has(p.attributeId)) {
      payloadAttributes.push(p);
      presentAttrIds.add(p.attributeId);
    }
  }
  const requiredMissing: TrendyolAttributeResolution['requiredMissing'] = [];
  for (const attr of attrs) {
    if (attr.required && !presentAttrIds.has(attr.attribute.id)) {
      requiredMissing.push({ attributeId: attr.attribute.id, attributeName: attr.attribute.name });
    }
  }

  // Değer düzeyinde hata varsa VARIANT_ATTRIBUTE_NOT_FOUND önceliklidir;
  // yalnızca "attribute hiç hedeflenmemişse" REQUIRED_ATTRIBUTE_MISSING denir.
  const status: TrendyolAttributeResolution['status'] =
    missing.length > 0
      ? 'VARIANT_ATTRIBUTE_NOT_FOUND'
      : requiredMissing.length > 0
        ? 'REQUIRED_ATTRIBUTE_MISSING'
        : 'OK';

  return { status, attributes: payloadAttributes, resolved, missing, requiredMissing };
}
