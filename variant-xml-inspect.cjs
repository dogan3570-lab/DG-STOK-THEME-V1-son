const { PrismaClient } = require('./server/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const srcs = await p.xmlSource.findMany({ select: { id: true, name: true, url: true, lastRawXml: true } });
  for (const s of srcs) {
    console.log('SRC:', s.id, '|', s.name, '| urlLen=', (s.url || '').length, '| rawXmlLen=', (s.lastRawXml || '').length);
    const raw = s.lastRawXml || '';
    if (raw) {
      const akyi = raw.match(/<AKYI[^>]*>([\s\S]*?)<\/AKYI>/i);
      console.log('  AKYI tag:', akyi ? JSON.stringify(akyi[1].trim().slice(0, 80)) : 'yok');
      // item/prodükt örneği
      const item = raw.match(/<(product|item)\b[^>]*>([\s\S]*?)<\/\1>/i);
      if (item) {
        const sample = item[2].replace(/\s+/g, ' ').trim();
        console.log('  ITEM SAMPLE:', sample.slice(0, 700));
      }
      // ilk 15 tag adı
      const tags = [...raw.matchAll(/<([A-Za-z_][\w:.-]*)\b[^>]*>/g)].map(m => m[1].toLowerCase());
      const uniq = [...new Set(tags)].slice(0, 60);
      console.log('  TAGS:', uniq.join(', '));
    }
  }
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
