// RED TEAM — AKILLIBAYI1 GERÇEK XML HAM YAPI ANALİZİ. SADECE OKUMA.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const XS = '949855eb-d68c-4920-b378-c622a6a665e2';

(async () => {
  const src = await prisma.xmlSource.findUnique({ where: { id: XS }, select: { id: true, name: true, url: true, sourceType: true, fieldMapping: true } });
  console.log('XML SOURCE:', src.name, '| url=', src.url, '| type=', src.sourceType);
  console.log('fieldMapping=', (src.fieldMapping || '(yok)').slice(0, 500));

  if (!src.url) {
    console.log('URL YOK — XML sadece manuel import edilmiş olabilir. DB ürün alanlarından yapı çıkarılacak.');
  } else {
    try {
      const res = await fetch(src.url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
      if (!res.ok) { console.log('FETCH HATA:', res.status); }
      else {
        const text = await res.text();
        console.log('XML BOYUT:', text.length, 'karakter');
        // benzersiz tag listesi
        const tags = new Set();
        const re = /<\/?([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>/g;
        let m;
        while ((m = re.exec(text)) !== null) tags.add(m[1].toLowerCase());
        console.log('TAG SAYISI (benzersiz):', tags.size);
        console.log('TAGLER:', [...tags].sort().join(', '));

        // kritik alan varlığı
        const wanted = ['parentid','groupid','itemparentid','itemgroupid','variant','option','productcode','modelcode','stockcode','sku','barcode','mainproduct','parentsku','groupsku','groupcode','productid','itemid','color','size','beden','renk','numara'];
        console.log('\nKRİTİK ALAN VARLIĞI:');
        for (const w of wanted) {
          const present = new RegExp('<'+w+'\\b', 'i').test(text);
          console.log(`  ${w} = ${present ? 'VAR' : 'YOK'}`);
        }

        // ürün kayıt sayısı
        const productCount = (text.match(/<(product|item)\b[^>]*>/gi) || []).length;
        console.log('\nÜRÜN/ITEM KAYIT SAYISI (açılış tag):', productCount);

        // ilk 2 ürün bloğu örneği
        const blocks = text.match(/<(product|item)\b[^>]*>[\s\S]*?<\/\1>/gi) || [];
        console.log('\nİLK 2 ÜRÜN BLOĞU:');
        for (let i = 0; i < Math.min(2, blocks.length); i++) {
          console.log('\n--- BLOCK ' + (i+1) + ' ---');
          console.log(blocks[i].slice(0, 1500));
        }
      }
    } catch (e) {
      console.log('FETCH EXCEPTION:', String(e).slice(0, 200));
    }
  }
  await prisma.$disconnect();
})().catch(e => { console.error('ERR', e); process.exitCode = 1; });
