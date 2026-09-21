// scripts/rt-xml-db-correlate.ts
// READ-ONLY: Correlate supplier XML <Id> with DB xmlKey, prove root cause
import { readFileSync } from 'node:fs';
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';

const prisma = new PrismaClient();
const FILE = 'C:/Users/Dogan/AppData/Local/Temp/opencode/buffer-feed.xml';
const xml = readFileSync(FILE, 'utf8');

function getTag(content: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

async function main() {
  const blocks = [...xml.matchAll(/<(Product|product|item)\b[^>]*>([\s\S]*?)<\/\1>/gi)];

  const xmlProducts = blocks.map(b => {
    const c = b[2];
    const id = getTag(c, 'Id');
    const stockCode = getTag(c, 'StockCode');
    const name = getTag(c, 'Name');
    const breadcrumb = getTag(c, 'CategoryBreadCrumb');
    const allTagNames = [...c.matchAll(/<([A-Za-z_][A-Za-z0-9_]*)>/g)].map(m => m[1]);
    const catTags = [...new Set(allTagNames)].filter(t => /categor|kategori|breadcrumb|group|type|shelf/i.test(t));
    return { id, stockCode, name, breadcrumb, catTags };
  });

  console.log('═══ XML <Id> analysis ═══');
  console.log(`Products with <Id>: ${xmlProducts.filter(p => p.id).length}/${xmlProducts.length}`);
  console.log(`Sample Ids: ${xmlProducts.slice(0, 5).map(p => p.id).join(', ')}`);
  console.log('');

  const dbProducts = await prisma.product.findMany({
    where: { xmlSourceId: '2fe5e126-3e1e-43a6-9b28-b77826300688', status: { not: 'DELETED' } },
    select: { id: true, xmlKey: true, title: true, supplierCategory: true, categoryId: true, matchedBy: true },
  });
  console.log(`DB products: ${dbProducts.length}`);
  console.log(`DB xmlKey samples: ${dbProducts.slice(0, 5).map(p => p.xmlKey).join(', ')}`);
  console.log('');

  const xmlById = new Map(xmlProducts.filter(p => p.id).map(p => [p.id as string, p]));
  const xmlByStock = new Map(xmlProducts.filter(p => p.stockCode).map(p => [p.stockCode as string, p]));

  let matchId = 0, matchStock = 0;
  for (const p of dbProducts.slice(0, 20)) {
    if (xmlById.has(p.xmlKey)) matchId++;
    if (xmlByStock.has(p.xmlKey)) matchStock++;
  }
  console.log(`First 20 DB xmlKeys → match XML <Id>: ${matchId}, match <StockCode>: ${matchStock}`);
  console.log('');

  const dbNull = dbProducts.filter(p => !p.supplierCategory);
  console.log(`═══ DB NULL supplierCategory: ${dbNull.length} ═══`);

  let xmlHasNoBreadcrumb = 0, xmlHasBreadcrumb = 0, notFound = 0;
  for (const p of dbNull) {
    const x = xmlById.get(p.xmlKey) || xmlByStock.get(p.xmlKey);
    if (!x) { notFound++; continue; }
    if (!x.breadcrumb) xmlHasNoBreadcrumb++; else xmlHasBreadcrumb++;
  }
  console.log(`  Of DB-null products, matched in XML:`);
  console.log(`    XML also has NO CategoryBreadCrumb: ${xmlHasNoBreadcrumb}`);
  console.log(`    XML HAS CategoryBreadCrumb (parsing bug!): ${xmlHasBreadcrumb}`);
  console.log(`    Not found in XML: ${notFound}`);
  console.log('');

  const two = dbProducts.filter(p => !p.supplierCategory && p.categoryId);
  console.log(`═══ The 2 products with categoryId but NULL supplierCategory ═══`);
  for (const p of two) {
    const x = xmlById.get(p.xmlKey) || xmlByStock.get(p.xmlKey);
    console.log(`  ${p.id.substring(0,8)} xmlKey=${p.xmlKey} matchedBy=${p.matchedBy} xmlBreadcrumb=${x?.breadcrumb ?? 'ABSENT'}`);
  }
  console.log('');

  const nullBc = xmlProducts.filter(p => !p.breadcrumb);
  console.log(`═══ XML products without breadcrumb: ${nullBc.length} ═══`);
  const catTagUsage = new Map<string, number>();
  for (const p of nullBc) for (const t of p.catTags) catTagUsage.set(t, (catTagUsage.get(t) || 0) + 1);
  console.log(`  Category-like tags present: ${catTagUsage.size === 0 ? 'NONE' : [...catTagUsage.entries()].map(([k,v]) => `${k}(${v})`).join(', ')}`);
  console.log('');

  const targetStock = 'KN-2355';
  const idx = xmlProducts.findIndex(p => p.stockCode === targetStock);
  if (idx >= 0) {
    const raw = blocks[idx][2];
    const cleaned = raw.replace(/<Description>[\s\S]*?<\/Description>/i, '<Description>...</Description>');
    console.log(`═══ RAW XML block for StockCode=${targetStock} (truncated) ═══`);
    console.log(cleaned.substring(0, 900));
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
