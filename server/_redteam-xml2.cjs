// RED TEAM — AKILLIBAYI1 XML: GERÇEK VARYANT AİLESİ TESPİTİ (modelCode/productCode analizi).
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const XS = '949855eb-d68c-4920-b378-c622a6a665e2';

function extract(content, tag) {
  const m = content.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  if (!m) return null;
  let v = m[1];
  const c = v.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  v = c ? c[1] : v;
  return v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

(async () => {
  const src = await prisma.xmlSource.findUnique({ where: { id: XS }, select: { url: true } });
  const res = await fetch(src.url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
  const text = await res.text();
  const blocks = text.match(/<product>[\s\S]*?<\/product>/gi) || [];
  console.log('ÜRÜN BLOĞU SAYISI:', blocks.length);

  const rows = [];
  for (const b of blocks) {
    rows.push({
      productCode: extract(b, 'productCode'),
      modelCode: extract(b, 'modelCode'),
      name: extract(b, 'name'),
    });
  }

  const pcSet = new Set(), mcSet = new Set();
  let pcEqMc = 0;
  for (const r of rows) {
    if (r.productCode) pcSet.add(r.productCode);
    if (r.modelCode) mcSet.add(r.modelCode);
    if (r.productCode && r.modelCode && r.productCode === r.modelCode) pcEqMc++;
  }
  console.log('productCode benzersiz:', pcSet.size, '/ toplam', rows.length);
  console.log('modelCode benzersiz:', mcSet.size, '/ toplam', rows.length);
  console.log('productCode === modelCode olan kayıt:', pcEqMc);

  // AYNI modelCode altında birden fazla FARKLI productCode var mı? (GÜÇLÜ varyant ailesi kanıtı)
  const modelToPcs = new Map();
  for (const r of rows) {
    if (!r.modelCode) continue;
    const s = modelToPcs.get(r.modelCode) || new Set();
    if (r.productCode) s.add(r.productCode);
    modelToPcs.set(r.modelCode, s);
  }
  let families = 0; const familyExamples = [];
  for (const [mc, pcs] of modelToPcs) {
    if (pcs.size > 1) { families++; if (familyExamples.length < 5) familyExamples.push({ modelCode: mc, productCodes: [...pcs].slice(0, 6) }); }
  }
  console.log('\nAYNI modelCode altında 2+ FARKLI productCode (GÜÇLÜ varyant ailesi):', families);
  for (const f of familyExamples) console.log('  modelCode=' + f.modelCode + ' productCodes=', JSON.stringify(f.productCodes));

  // AYNI productCode altında 2+ kayıt (duplicate ürün) var mı?
  const pcCount = new Map();
  for (const r of rows) { if (r.productCode) pcCount.set(r.productCode, (pcCount.get(r.productCode) || 0) + 1); }
  let dupPc = 0; for (const [, c] of pcCount) if (c > 1) dupPc++;
  console.log('aynı productCode 2+ kayıt (duplicate):', dupPc);

  // Başlık kök + renk analizi: Airpods örneği
  console.log('\n=== AIRPODS SPOR DELİKLİ KILIF AİLESİ (title bazlı) ===');
  const airpods = rows.filter(r => (r.name || '').includes('Spor Delikli'));
  console.log('Spor Delikli içeren ürün:', airpods.length);
  for (const a of airpods.slice(0, 12)) console.log('  [' + a.modelCode + '] ' + a.name);

  await prisma.$disconnect();
})().catch(e => { console.error('ERR', e); process.exitCode = 1; });
