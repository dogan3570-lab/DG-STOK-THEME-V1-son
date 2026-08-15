const BASE = 'http://localhost:4000';

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  let body = null;
  try { body = await res.json(); } catch { body = await res.text(); }
  return { status: res.status, body };
}

(async () => {
  const out = [];
  const log = (s) => { console.log(s); out.push(s); };

  log('=== CONTEXT-001 CANLI KONTROL ===\n');

  // 1. Login
  const login = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }),
  });
  const token = login.body?.token;
  log('LOGIN: ' + login.status + (token ? ' (token alindi)' : ' (TOKEN YOK: ' + JSON.stringify(login.body) + ')'));
  const auth = { headers: { Authorization: 'Bearer ' + token } };

  // 2. Marketplaces (public)
  const mps = await api('/marketplaces');
  const mpItems = mps.body?.items || [];
  log('\nMARKETPLACES: ' + mps.status + ' -> ' + mpItems.map(m => m.key + ':' + m.name + ':' + m.id).join(', '));

  // 3. XML sources
  const xml = await api('/xml-sources', auth);
  const xmlItems = xml.body?.items || xml.body?.data || [];
  log('XML-SOURCES: ' + xml.status + ' -> ' + (Array.isArray(xmlItems) ? xmlItems.map(x => x.name + ':' + x.id).join(', ') : JSON.stringify(xml.body)));

  // 4. Products context'siz (beklenen: yeni kodda 400 CONTEXT_REQUIRED)
  const pNoCtx = await api('/products', auth);
  log('\nPRODUCTS context YOK: ' + pNoCtx.status + ' -> ' + JSON.stringify(pNoCtx.body).slice(0, 160));

  // 5. Products context'li
  if (xmlItems.length && mpItems.length) {
    const xid = xmlItems.find(x => x.id)?.id;
    const mid = mpItems[0]?.id;
    const pCtx = await api('/products?page=1&limit=10&xmlSourceId=' + xid + '&marketplaceId=' + mid, auth);
    const total = pCtx.body?.pagination?.total ?? pCtx.body?.total ?? null;
    log('PRODUCTS context VAR: ' + pCtx.status + ' -> total=' + total + ' (ilk eleman sayisi=' + (pCtx.body?.items?.length ?? '?') + ')');
  } else {
    log('PRODUCTS context VAR: ATLANDI (xml/mp bulunamadi)');
  }

  // 6. Categories authsiz (beklenen: 401)
  const catNoAuth = await api('/categories');
  log('\nCATEGORIES auth YOK: ' + catNoAuth.status + ' -> ' + JSON.stringify(catNoAuth.body).slice(0, 120));

  // 7. Categories auth'lu context'siz (prepCategories hala context gerektiriyor mu?)
  const catAuth = await api('/categories', auth);
  const catCount = catAuth.body?.items?.length ?? null;
  log('CATEGORIES auth VAR: ' + catAuth.status + ' -> items=' + catCount);

  // 8. Brands authsiz (beklenen: 401?)
  const brNoAuth = await api('/brands');
  log('BRANDS auth YOK: ' + brNoAuth.status + ' -> ' + JSON.stringify(brNoAuth.body).slice(0, 120));

  // 9. Variants authsiz
  const varNoAuth = await api('/variants?page=1&limit=2');
  log('VARIANTS auth YOK: ' + varNoAuth.status + ' -> ' + JSON.stringify(varNoAuth.body).slice(0, 120));

  // 10. XML import (DOMParser kontrolu)
  const xmlImport = await api('/xml/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ xml: '<root><item><sku>TEST1</sku><title>T</title></item></root>' }),
  });
  log('\nXML IMPORT gecerli: ' + xmlImport.status + ' -> ' + JSON.stringify(xmlImport.body).slice(0, 200));

  log('\n=== KONTROL BITTI ===');
})().catch(e => { console.error('SCRIPT ERROR:', e); process.exit(1); });
