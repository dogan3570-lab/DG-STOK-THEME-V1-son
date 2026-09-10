// GEÇİCİ — AKILLIBAYI1 XML yapısını incele (yalnızca okuma, ağ).
(async () => {
  const url = 'https://akillibayi.com.tr/xml/market/v3162fc178fef141968c08047afa3b658db48097902861462da4d78ddc95baaf54/hepsiburada/part-1.xml';
  const res = await fetch(url, { redirect: 'follow' });
  const xml = await res.text();
  console.log('XML_LENGTH', xml.length);

  // product/item tag'lerini bul
  const productRegex = /<(product|item)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const matches = Array.from(xml.matchAll(productRegex));
  console.log('PRODUCT_COUNT', matches.length);

  // İlk ürünün içeriğini göster
  if (matches.length > 0) {
    const first = matches[0][2] || '';
    console.log('FIRST_PRODUCT', first.slice(0, 3000));
  }

  // Varyant/parent/group/color/beden alanları ara
  const keywords = ['parent', 'variant', 'group', 'color', 'renk', 'beden', 'size', 'option', 'itemid', 'parentid', 'groupid'];
  const counts = {};
  for (const k of keywords) {
    const re = new RegExp('<' + k + '\\b', 'gi');
    const m = xml.match(re);
    counts[k] = m ? m.length : 0;
  }
  console.log('KEYWORD_TAG_COUNTS', JSON.stringify(counts));

  // Başlıkta "Siyah-Beyaz" geçen bir product bloğu
  const sbMatch = Array.from(xml.matchAll(productRegex)).find((m) => (m[2] || '').includes('Siyah-Beyaz'));
  if (sbMatch) console.log('SIYAH_BEYAZ_XML_BLOCK', (sbMatch[2] || '').slice(0, 2500));
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
