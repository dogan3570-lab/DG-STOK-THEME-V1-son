// scripts/rt-xml-feed-inspect.mjs
// READ-ONLY: Parse supplier XML feed directly (downloaded copy)
import { readFileSync } from 'node:fs';

const FILE = 'C:/Users/Dogan/AppData/Local/Temp/opencode/buffer-feed.xml';
const xml = readFileSync(FILE, 'utf8');

console.log(`File size: ${xml.length} chars`);

// Match all product blocks
const productRegex = /<(Product|product|item)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const blocks = [...xml.matchAll(productRegex)];
console.log(`Product blocks: ${blocks.length}`);
console.log('');

// Inspect tags present in the first block
const first = blocks[0][2];
const allTags = [...first.matchAll(/<([A-Za-z_][A-Za-z0-9_]*)>/g)].map(m => m[1]);
const uniqueTags = [...new Set(allTags)];
console.log(`Tags in first product: ${uniqueTags.join(', ')}`);
console.log('');

// Check for Id-like tags
const idTags = uniqueTags.filter(t => /id|key|code/i.test(t));
console.log(`Id-like tags: ${idTags.join(', ')}`);
console.log('');

// Extract and classify each product
function getTag(content, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

const products = blocks.map(b => {
  const content = b[2];
  const stockCode = getTag(content, 'StockCode');
  const name = getTag(content, 'Name');
  const breadcrumb = getTag(content, 'CategoryBreadCrumb');
  const category = getTag(content, 'Category');
  return { stockCode, name, breadcrumb, category };
});

const withBreadcrumb = products.filter(p => p.breadcrumb);
const withoutBreadcrumb = products.filter(p => !p.breadcrumb);
console.log(`Products WITH CategoryBreadCrumb: ${withBreadcrumb.length}`);
console.log(`Products WITHOUT CategoryBreadCrumb: ${withoutBreadcrumb.length}`);
console.log('');

// Show samples without breadcrumb
console.log('=== 10 products WITHOUT CategoryBreadCrumb ===');
for (const p of withoutBreadcrumb.slice(0, 10)) {
  console.log(`  StockCode=${p.stockCode ?? 'NULL'} | Cat=${p.category ?? 'NULL'} | ${(p.name ?? '').substring(0, 55)}`);
}
console.log('');

// Show StockCode ranges
console.log('=== StockCode samples ===');
for (const p of products.slice(0, 5)) {
  console.log(`  ${p.stockCode} | ${(p.breadcrumb ?? 'NO_BREADCRUMB').substring(0, 60)}`);
}
console.log('');

// Check whether ANY product uses numeric id-like 4-digit keys
console.log('=== Searching for numeric IDs matching DB xmlKeys (5587, 160800) ===');
const match5587 = products.filter(p => p.stockCode === '5587' || (p.name ?? '').includes('Islak/kuru Kirli Temiz Kiyafet'));
console.log(`Products matching 5587/title: ${match5587.length}`);
for (const p of match5587.slice(0, 3)) {
  console.log(`  StockCode=${p.stockCode} | breadcrumb=${p.breadcrumb ?? 'NULL'}`);
}
