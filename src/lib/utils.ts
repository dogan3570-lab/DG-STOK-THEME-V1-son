export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null) return '-';
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(value);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  try { return new Date(value).toLocaleString('tr-TR'); } catch { return value; }
}

export function getImageList(images: any): string[] {
  if (!images) return [];
  if (Array.isArray(images)) return images;
  if (typeof images === 'string') { try { return JSON.parse(images); } catch { return [images]; } }
  return [];
}

export function getStockStatus(stock: number): { label: string; color: string } {
  if (stock <= 0) return { label: 'Stok Yok', color: 'text-red-600' };
  if (stock <= 5) return { label: 'Kritik', color: 'text-orange-600' };
  if (stock <= 20) return { label: 'Az', color: 'text-yellow-600' };
  return { label: 'Yeterli', color: 'text-green-600' };
}

export function getQualityLevel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: 'Mükemmel', color: 'text-green-600' };
  if (score >= 70) return { label: 'İyi', color: 'text-blue-600' };
  if (score >= 50) return { label: 'Orta', color: 'text-yellow-600' };
  return { label: 'Düşük', color: 'text-red-600' };
}

export function calculateProfitMargin(purchasePrice: number | null, salePrice: number | null): number | null {
  if (!purchasePrice || !salePrice || purchasePrice <= 0) return null;
  return ((salePrice - purchasePrice) / purchasePrice) * 100;
}
