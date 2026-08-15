import type { Prisma } from '@prisma/client';

/**
 * TEK AUTHORITATIVE 4/4 READINESS KURALI.
 * Gönderime hazır olmak için 4 alt modülün TAMAMI tamam olmalıdır:
 *   1. KATEGORİ   → categoryMatch
 *   2. MARKA      → brandMatch
 *   3. VARYANT    → variantMatch=true VEYA variantStatus='NOT_REQUIRED' (XML'de gerçek varyant yok)
 *   4. LİSTELEME  → templateMatch
 * Ayrıca status='READY' olmalıdır.
 */

const COLORS = new Set([
  'black', 'white', 'red', 'blue', 'green', 'yellow', 'purple', 'orange',
  'pink', 'gray', 'grey', 'brown', 'beige', 'navy', 'silver', 'gold', 'cream',
  'siyah', 'beyaz', 'kirmizi', 'mavi', 'yesil', 'sari', 'mor', 'turuncu',
  'pembe', 'lacivert', 'bordo', 'bej', 'kahverengi', 'krem', 'gri', 'altin',
  'gumus', 'metalik', 'fume',
]);

const COLOR_LABEL: Record<string, string> = {
  black: 'Siyah', white: 'Beyaz', red: 'Kirmizi', blue: 'Mavi', green: 'Yesil',
  yellow: 'Sari', purple: 'Mor', orange: 'Turuncu', pink: 'Pembe', gray: 'Gri',
  grey: 'Gri', brown: 'Kahverengi', beige: 'Bej', navy: 'Lacivert', silver: 'Gumus',
  gold: 'Altin', cream: 'Krem', siyah: 'Siyah', beyaz: 'Beyaz', kirmizi: 'Kirmizi',
  mavi: 'Mavi', yesil: 'Yesil', sari: 'Sari', mor: 'Mor', turuncu: 'Turuncu',
  pembe: 'Pembe', lacivert: 'Lacivert', bordo: 'Bordo', bej: 'Bej', kahverengi: 'Kahverengi',
  krem: 'Krem', gri: 'Gri', altin: 'Altin', gumus: 'Gumus', metalik: 'Gri', fume: 'Gri',
};

const SIZES = new Set([
  'xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', '2xl', '3xl', '4xl', '5xl',
  'small', 'medium', 'large', 'xlarge',
]);

function tokenize(text: string): string[] {
  return (text || '').toLowerCase().split(/[^a-z0-9çğıöşü]+/).filter(Boolean);
}

export interface DetectedVariant {
  name: string;
  value: string;
}

/** XML başlık/key/açıklama metninden GERÇEK varyant işaretlerini (renk/beden/numara/kapasite) tespit eder. */
export function detectVariantAttributes(text: string): DetectedVariant[] {
  const tokens = tokenize(text);
  const found: DetectedVariant[] = [];

  for (const token of tokens) {
    if (COLORS.has(token)) {
      found.push({ name: 'Renk', value: COLOR_LABEL[token] || token });
      break;
    }
  }
  for (const token of tokens) {
    if (SIZES.has(token)) {
      found.push({ name: 'Beden', value: token.toUpperCase() });
      break;
    }
  }
  for (const token of tokens) {
    if (/^(3[2-9]|4[0-9]|50)$/.test(token)) {
      found.push({ name: 'Numara', value: token });
      break;
    }
  }
  for (const token of tokens) {
    const cap = token.match(/^(\d+)(gb|tb|mb)$/);
    if (cap) {
      found.push({ name: 'Kapasite', value: cap[1].toUpperCase() + cap[2].toUpperCase() });
      break;
    }
  }

  return found;
}

export function hasVariantAttributes(text: string): boolean {
  return detectVariantAttributes(text).length > 0;
}

export type ReadinessProduct = {
  status: string;
  categoryMatch: boolean;
  brandMatch: boolean;
  templateMatch: boolean;
  variantMatch: boolean;
  variantStatus?: string | null;
};

/** Varyant aşaması tamam mı: eşleşmiş VEYA XML'de varyant yok (NOT_REQUIRED). */
export function isVariantComplete(product: { variantMatch: boolean; variantStatus?: string | null }): boolean {
  return product.variantMatch === true || product.variantStatus === 'NOT_REQUIRED';
}

/** 4 hazırlık aşamasının tamamı tamam mı (status bağımsız). */
export function isPrepComplete(product: ReadinessProduct): boolean {
  return (
    product.categoryMatch === true &&
    product.brandMatch === true &&
    product.templateMatch === true &&
    isVariantComplete(product)
  );
}

/** Gönderime hazır mı: status READY + 4/4 tamam. */
export function isReady(product: ReadinessProduct): boolean {
  return product.status === 'READY' && isPrepComplete(product);
}

/** Prisma count/findMany için tek authoritative READY filtresi. */
export const READY_FILTER = {
  status: 'READY',
  categoryMatch: true,
  brandMatch: true,
  templateMatch: true,
  OR: [
    { variantMatch: true },
    { variantStatus: 'NOT_REQUIRED' },
  ],
} satisfies Prisma.ProductWhereInput;
