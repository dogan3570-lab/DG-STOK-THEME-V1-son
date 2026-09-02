// FIX(V2 #3): DIRECT BYPASS kaldırıldı — transport Master Orchestrator üzerinden.
import { chatCompletion, type ChatMessage } from './aiGateway.ts';
import { tokensOf, GENERIC_CATEGORY_TOKENS } from './categoryMatchEngine.ts';

export interface SemanticIdentity {
  coreObject: string;
  productType: string;
  primaryFunction: string;
  secondaryFunction: string | null;
  useCase: string;
  targetUser: string | null;
  material: string | null;
  formFactor: string | null;
  powerType: string | null;
  keyAttributes: string[];
  excludedInterpretations: string[];
  supplierCategoryTrust: number;
  needsImageInspection: boolean;
  domain: string;
  confidence: number;
}

// ==================== TITLE PRE-PROCESSING ====================
// This is the REAL fix: clean the title BEFORE the AI sees it.

const BRAND_PATTERNS = [
  /^HOBİBAHÇEM[®™]?\s*/i,
  /^HOBİBAHCEM[®™]?\s*/i,
  /^Hobi\s*Bahcem[®™]?\s*/i,
];

const MODEL_PATTERNS = [
  /\b[A-Z]{1,4}\d{2,5}\b/g,
  /\b\d+[A-Z]{1,3}\b/g,
];

const MARKETING_WORDS = [
  'hobibahcem', 'hobi bahcem', 'hobbahcem',
  'pro', 'premium', 'plus', 'max', 'mini', 'ultra',
  'vintage', 'dekoratif', 'özel', 'ozel', 'sisli', 'şömalı',
  'profesyonel', 'yeni', 'yedek', 'kaliteli',
];

const SIZE_PATTERNS = [
  /\b\d+\s*(kisilik|kişilik|li|lı|lu|lü)\b/gi,
  /\b\d+\s*x\s*\d+(\s*x\s*\d+)?\s*(cm|m|mm)?\b/gi,
  /\b\d+\s*(cm|m|mm|w|mah|gb|tb|ml|lt|kg|gr)\b/gi,
];

const APPEARANCE_WORDS = [
  'gorunumlu', 'görünümlü', 'sekilli', 'şekilli', 'bicimli', 'biçimli',
  'tipinde', 'formunda', 'gibi', 'benzeri', 'vari', 'kili',
  'tasarimli', 'tasarımlı', 'görünüm',
];

export function cleanTitle(rawTitle: string, brand?: string | null): string {
  let title = rawTitle;

  // 1) Strip registered trademark / trademark symbols
  title = title.replace(/[®™©]/g, '');

  // 2) Strip brand names
  for (const bp of BRAND_PATTERNS) {
    title = title.replace(bp, '');
  }
  if (brand) {
    const brandEscaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title.replace(new RegExp(`^${brandEscaped}[®™]?\s*`, 'gi'), '');
  }

  // 3) Strip model numbers
  for (const mp of MODEL_PATTERNS) {
    title = title.replace(mp, '');
  }

  // 4) Strip marketing words
  for (const mw of MARKETING_WORDS) {
    title = title.replace(new RegExp(`\\b${mw}\\b`, 'gi'), '');
  }

  // 5) Strip size/spec patterns
  for (const sp of SIZE_PATTERNS) {
    title = title.replace(sp, '');
  }

  // 6) Strip "X Gorunumlu Y" patterns — the product IS Y, not X
  // "Gaz Lambasi Gorunumlu Aromaterapi Difuzor" → "Aromaterapi Difuzor"
  for (const aw of APPEARANCE_WORDS) {
    const pattern = new RegExp(`[\\wçğıöşü]+\\s+[\\wçğıöşü]+\\s+${aw}\\b`, 'gi');
    title = title.replace(pattern, '');
    const pattern2 = new RegExp(`[\\wçğıöşü]+\\s+${aw}\\b`, 'gi');
    title = title.replace(pattern2, '');
  }

  // 7) Normalize Turkish characters for matching
  title = title
    .replace(/İ/g, 'i').replace(/I/g, 'i')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/Ü/g, 'u')
    .replace(/ş/g, 's').replace(/Ş/g, 's')
    .replace(/ö/g, 'o').replace(/Ö/g, 'o')
    .replace(/ç/g, 'c').replace(/Ç/g, 'c');

  // 7) Collapse whitespace
  title = title.replace(/\s+/g, ' ').trim();

  return title;
}

// ==================== SYSTEM PROMPT ====================

const SYSTEM_PROMPT = `You are a product type classifier for e-commerce.

TASK: Given a product title (already cleaned of brand/model/marketing words), determine WHAT TYPE OF PRODUCT it is.

The title you receive has been pre-processed. Brand names, model numbers, and marketing words have been removed.

OUTPUT FORMAT (JSON only):
{
  "coreObject": "the fundamental product type (1-3 words, lowercase Turkish). Examples: 'kulaklik', 'kulluk', 'cadir', 'aromaterapi difuzoru', 'pil', 'kumanda', ' LED isik'",
  "primaryFunction": "what the product does (1 sentence)",
  "excludedInterpretations": ["product types this is definitely NOT"],
  "needsImageInspection": true/false,
  "confidence": 0.0-1.0
}

RULES:
1. coreObject must be the PRODUCT TYPE, not a description. Example: "kulaklik" not "kulaklik urunu"
2. "Gorunumlu" or "gorunumlu" means "shaped like" — this is APPEARANCE, not product type
3. "Gaz Lambasi Gorunumlu Aromaterapi Difuzoru" → coreObject = "aromaterapi difuzoru", NOT "gaz lambasi"
4. If the title contains "X Gorunumlu Y", the product IS Y, not X
5. excludedInterpretations must list at least 2 product types this is NOT
6. If the title has multiple words like "Surmene Kemik Siyirma Kasap Bicak", the coreObject is "kasap bicagi" — the last meaningful product-type word(s), NOT the first words which are often origin/brand/descriptor
7. Look for the actual product noun in the title: "Kulaklik", "Kulluk", "Bicak", "Kumanda", "Pil", "Cadiri" etc.
8. Return ONLY valid JSON, no markdown, no explanation`;

// ==================== MAIN FUNCTION ====================

export async function understandProduct(
  product: {
    title: string | null;
    description: string | null;
    xmlBrandName: string | null;
    supplierCategory: string | null;
  },
  previousErrors?: string,
): Promise<SemanticIdentity> {
  const rawTitle = product.title || '';
  const brand = product.xmlBrandName || '';
  const supplierCat = product.supplierCategory || '';

  // PRE-PROCESS: Clean the title before AI sees it
  const cleanedTitle = cleanTitle(rawTitle, brand);

  const userMessage = `Product title: "${cleanedTitle}"
Original title: "${rawTitle}"
Supplier category (LOW TRUST): "${supplierCat}"
${previousErrors ? `Previous errors: ${previousErrors}` : ''}

What type of product is this? Return ONLY the JSON.`;

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  const result = await chatCompletion({
    messages,
    temperature: 0.1,
    max_tokens: 800,
    response_format: { type: 'json_object' },
  }, 'STRUCTURED_OUTPUT');

  if (!result.ok || !result.content) {
    return fallbackIdentity(cleanedTitle, rawTitle);
  }

  try {
    const parsed = JSON.parse(result.content);

    // POST-PROCESS: Final safety strip on coreObject
    let coreObj = String(parsed.coreObject || '').trim();
    coreObj = cleanTitle(coreObj, brand); // Apply same cleaning to output
    // Strip trailing modifiers that inflate the coreObject
    coreObj = stripModifiers(coreObj);
    if (!coreObj || coreObj.length < 2) {
      coreObj = extractCoreFromCleanedTitle(cleanedTitle);
    }

    return {
      coreObject: coreObj,
      productType: coreObj,
      primaryFunction: String(parsed.primaryFunction || ''),
      secondaryFunction: null,
      useCase: String(parsed.primaryFunction || ''),
      targetUser: null,
      material: null,
      formFactor: null,
      powerType: null,
      keyAttributes: [],
      excludedInterpretations: Array.isArray(parsed.excludedInterpretations) ? parsed.excludedInterpretations.map(String) : [],
      supplierCategoryTrust: 0.05,
      needsImageInspection: Boolean(parsed.needsImageInspection),
      domain: '',
      confidence: clamp(parseFloat(parsed.confidence) || 0.7, 0, 1),
    };
  } catch {
    return fallbackIdentity(cleanedTitle, rawTitle);
  }
}

// ==================== HELPERS ====================

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function extractCoreFromCleanedTitle(cleanedTitle: string): string {
  const tokens = tokensOf(cleanedTitle).filter((t: string) => !GENERIC_CATEGORY_TOKENS.has(t) && t.length >= 3);
  return tokens.slice(0, 3).join(' ') || 'bilinmeyen urun';
}

const MODIFIER_WORDS = new Set([
  'tasinabilir', 'kompakt', 'hafif', 'ince', 'kalın', 'buyuk', 'kucuk',
  'mini', 'maxi', 'profesyonel', 'endustriyel', 'otomatik', 'manuel',
  'kablolu', 'kablosuz', 'bluetooth', 'wifi', 'usb', 'typec', 'type-c',
  'sac', 'sarj', 'elektrikli', 'pil', 'akulu',
]);

function stripModifiers(coreObj: string): string {
  const tokens = coreObj.split(/\s+/);
  // Keep stripping trailing modifier words until we hit a product-type word
  while (tokens.length > 1 && MODIFIER_WORDS.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop();
  }
  return tokens.join(' ');
}

function fallbackIdentity(cleanedTitle: string, rawTitle: string): SemanticIdentity {
  const coreObj = extractCoreFromCleanedTitle(cleanedTitle);
  return {
    coreObject: coreObj,
    productType: coreObj,
    primaryFunction: 'bilinmeyen',
    secondaryFunction: null,
    useCase: 'bilinmeyen',
    targetUser: null,
    material: null,
    formFactor: null,
    powerType: null,
    keyAttributes: [],
    excludedInterpretations: [],
    supplierCategoryTrust: 0.05,
    needsImageInspection: true,
    domain: 'bilinmeyen',
    confidence: 0.1,
  };
}
