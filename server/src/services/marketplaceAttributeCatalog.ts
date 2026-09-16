/**
 * GLOBAL MARKETPLACE ATTRIBUTE CATALOG — seçili pazaryerinin GERÇEK kategori
 * attribute ağacını ve GERÇEK attribute/valueId listesini tek arayüzden sunar.
 *
 * KESİN KURALLAR:
 *  - Gerçek katalog yoksa (henüz entegre edilmemiş pazaryeri) `supported=false`
 *    döner ve HİÇBİR değer/ID üretilmez (fail-closed). Uydurma YOK.
 *  - Trendyol gerçek read-only catalog endpoint'lerini kullanır (davranış aynı).
 *  - Trendyol'a özel iş kuralları (Menşei=TR vb.) BURADA DEĞİL, motorun
 *    korunmuş tt kural katmanındadır; diğer pazaryerlerine genellenmez.
 */
import { fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from './trendyolCatalog.ts';

export interface MarketplaceAttributeDef {
  attributeId: number;
  attributeName: string;
  required: boolean;
  varianter: boolean;
  slicer: boolean;
  allowCustom: boolean;
}

export interface MarketplaceAttributeValue {
  attributeValueId: number;
  attributeValue: string;
}

export interface MarketplaceAttributeCatalog {
  key: string;
  supported: boolean;
  /** supported=false ise neden (UI/log için). */
  reason: string | null;
  getCategoryAttributes(categoryExternalId: number): Promise<MarketplaceAttributeDef[]>;
  getAttributeValues(categoryExternalId: number, attributeId: number): Promise<MarketplaceAttributeValue[]>;
}

const ttCatalog: MarketplaceAttributeCatalog = {
  key: 'tt',
  supported: true,
  reason: null,
  async getCategoryAttributes(categoryExternalId: number) {
    const defs = await fetchTrendyolCategoryAttributes(categoryExternalId);
    return (Array.isArray(defs) ? defs : []).map((a) => ({
      attributeId: a.attribute.id,
      attributeName: a.attribute.name,
      required: !!a.required,
      varianter: !!a.varianter,
      slicer: !!a.slicer,
      allowCustom: !!a.allowCustom,
    }));
  },
  async getAttributeValues(categoryExternalId: number, attributeId: number) {
    const vals = await fetchTrendyolAttributeValues(categoryExternalId, attributeId);
    return (Array.isArray(vals) ? vals : []).map((v) => ({
      attributeValueId: v.attributeValueId,
      attributeValue: v.attributeValue,
    }));
  },
};

function unsupportedCatalog(key: string): MarketplaceAttributeCatalog {
  return {
    key,
    supported: false,
    reason: 'MARKETPLACE_ATTRIBUTE_NOT_SUPPORTED',
    async getCategoryAttributes() {
      return [];
    },
    async getAttributeValues() {
      return [];
    },
  };
}

// Gerçek katalog client'ı olmayan pazaryerleri fail-closed davranır.
const CATALOGS: Record<string, MarketplaceAttributeCatalog> = {
  tt: ttCatalog,
  he: unsupportedCatalog('he'),
  n11: unsupportedCatalog('n11'),
  amazon: unsupportedCatalog('amazon'),
  pazarama: unsupportedCatalog('pazarama'),
};

export function getMarketplaceAttributeCatalog(key: string): MarketplaceAttributeCatalog {
  return CATALOGS[key] ?? unsupportedCatalog(key);
}

export function isMarketplaceAttributeCatalogSupported(key: string): boolean {
  return getMarketplaceAttributeCatalog(key).supported;
}
