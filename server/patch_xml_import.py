import re

# Read the file
with open(r'C:\PROJE 1\DG-STOK-THEME-V1\server\src\services\xmlImport.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add the purchasePrice field to XmlImportProduct type
old_type = """export type XmlImportProduct = {
  xmlKey: string;
  title: string | null;
  sku: string;
  barcode: string | null;
  stock: number;
  minStock: number;
  price: number | null;
  listPrice: number | null;
  tax: number | null;
  currency: string | null;
  brand: string | null;
  category: string | null;
  mainCategory: string | null;
  topCategory: string | null;
  subCategory: string | null;
  description: string | null;
  detail: string | null;
  images: string | null;
  link: string | null;
  unit: string | null;
  active: boolean;
  // Gerçek varyant yapısı: yalnızca XML parent/group kayıtlarından tespit edilir.
  parentId: string | null;
  groupId: string | null;
};"""

new_type = """export type XmlImportProduct = {
  xmlKey: string;
  title: string | null;
  sku: string;
  barcode: string | null;
  stock: number;
  minStock: number;
  price: number | null;
  listPrice: number | null;
  tax: number | null;
  currency: string | null;
  brand: string | null;
  category: string | null;
  mainCategory: string | null;
  topCategory: string | null;
  subCategory: string | null;
  description: string | null;
  detail: string | null;
  images: string | null;
  link: string | null;
  unit: string | null;
  active: boolean;
  // Gerçek varyant yapısı: yalnızca XML parent/group kayıtlarından tespit edilir.
  parentId: string | null;
  groupId: string | null;
  purchasePrice: number | null;
};"""

content = content.replace(old_type, new_type)

# 2. Add DEFAULT_PURCHASE_PRICE_FIELDS and extractPurchasePrice function before parseXmlImportPayload
old_function_start = """export function parseXmlImportPayload(xml: string): XmlImportProduct[] {
  const parsed = parseXmlDocument(xml);"""

new_function_start = """const DEFAULT_PURCHASE_PRICE_FIELDS = [
  'purchasePrice',
  'purchase_price',
  'wholesalePrice',
  'wholesale_price',
  'costPrice',
  'cost_price',
  'supplierPrice',
  'supplier_price',
  'tedarikciFiyati',
  'alisfiyati',
  'alisfiyat',
  'alisFiyati',
  'alisFiyat',
  'PurchasePrice',
  'WholesalePrice',
  'CostPrice',
];

function extractPurchasePrice(content: string, purchasePriceField?: string | null): number | null {
  const fieldsToTry = purchasePriceField ? [purchasePriceField, ...DEFAULT_PURCHASE_PRICE_FIELDS] : DEFAULT_PURCHASE_PRICE_FIELDS;
  for (const field of fieldsToTry) {
    const value = extractTagValue(content, field);
    if (value != null) {
      const parsed = Number.parseFloat(value);
      if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
    }
  }
  return null;
}

export function parseXmlImportPayload(xml: string, purchasePriceField?: string | null): XmlImportProduct[] {
  const parsed = parseXmlDocument(xml);"""

content = content.replace(old_function_start, new_function_start)

# 3. Add purchasePrice extraction inside the map function - find the activeValue line and add after it
old_active = """      const activeValue = extractTagValue(content, 'active');

      const images: string[] = [];"""

new_active = """      const activeValue = extractTagValue(content, 'active');

      // Purchase price extraction — configurable field + common defaults
      const purchasePrice = extractPurchasePrice(content, purchasePriceField);

      const images: string[] = [];"""

content = content.replace(old_active, new_active)

# 4. Add purchasePrice to the return object
old_return = """        parentId: parentId || null,
        groupId: groupId || null,
      } satisfies XmlImportProduct;"""

new_return = """        parentId: parentId || null,
        groupId: groupId || null,
        purchasePrice,
      } satisfies XmlImportProduct;"""

content = content.replace(old_return, new_return)

# Write the file
with open(r'C:\PROJE 1\DG-STOK-THEME-V1\server\src\services\xmlImport.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patches applied successfully!")