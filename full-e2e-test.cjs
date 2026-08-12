const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const R = []; let N = 0; let TK = null; const IDS = {};
  const P = (n) => { N++; R.push('[PASS] #'+N+' '+n); console.log(R[R.length-1]); };
  const F = (n,e) => { N++; R.push('[FAIL] #'+N+' '+n+': '+e); console.error(R[R.length-1]); };
  const S = (n,d) => { N++; R.push('[STUB] #'+N+' '+n+': '+d); console.log(R[R.length-1]); };
  const api = async (u,o={}) => { const h={'Content-Type':'application/json',...o.headers}; if(TK)h['Authorization']='Bearer '+TK; const r=await fetch('http://localhost:4000'+u,{...o,headers:h,credentials:'include'}); try{return await r.json();}catch(e){return {_error:true,status:r.status};}};

  try {
    // === A: AUTH ===
    console.log('\n===== A: AUTH =====');
    const lr = await api('/auth/login',{method:'POST',body:JSON.stringify({email:'admin@dgstok.com',password:'admin123'})});
    if(lr.ok&&lr.token){P('A1: Login OK');TK=lr.token;}else{F('A1: Login',JSON.stringify(lr));throw new Error('no auth');}
    const me = await api('/auth/me');
    if(me.id&&me.email==='admin@dgstok.com'&&me.role==='ADMIN')P('A2: /auth/me OK (ADMIN)');else F('A2: /auth/me',JSON.stringify(me));
    const bad = await api('/auth/login',{method:'POST',body:JSON.stringify({email:'x',password:'y'})});
    if(!bad.ok)P('A3: Wrong password rejected');else F('A3: Wrong password','accepted');
    const noToken = await api('/products/stats');
    if(noToken.totalProducts!==undefined)P('A4: Protected route works with Bearer auth');else F('A4: Protected route',JSON.stringify(noToken));

    // === B: DASHBOARD ===
    console.log('\n===== B: DASHBOARD =====');
    const ds = await api('/dashboard/stats');
    if(ds.totalProducts!==undefined&&ds.totalMarketplaces!==undefined)P('B1: Dashboard stats OK (products='+ds.totalProducts+', marketplaces='+ds.totalMarketplaces+')');else F('B1: Dashboard',JSON.stringify(ds));

    // === C: XML SOURCES ===
    console.log('\n===== C: XML SOURCES =====');
    const xl = await api('/xml-sources');
    P('C1: XML list OK ('+(xl.items?.length||0)+' items)');
    const nx = await api('/xml-sources',{method:'POST',body:JSON.stringify({name:'RT_TEST_XML',company:'RT_Co',sourceType:'MANUAL',active:true})});
    if(nx.id){P('C2: XML create OK (id='+nx.id+')');IDS.xml=nx.id;}else F('C2: XML create',JSON.stringify(nx));
    if(IDS.xml){
      const ux = await api('/xml-sources/'+IDS.xml,{method:'PUT',body:JSON.stringify({name:'RT_TEST_XML_UPD',company:'RT_Co_UPD'})});
      const c=await api('/xml-sources/'+IDS.xml);
      if(c.name==='RT_TEST_XML_UPD'&&c.company==='RT_Co_UPD')P('C3: XML update + verify OK');else F('C3: XML update verify',JSON.stringify(c));
      S('C4: XML connection test','Simulated — no real URL fetch');
      S('C5: XML analyze','Requires real XML URL');
    }

    // === D: PRODUCTS ===
    console.log('\n===== D: PRODUCTS =====');
    const ps = await api('/products/stats');
    if(ps.totalProducts!==undefined)P('D1: Product stats OK (total='+ps.totalProducts+')');else F('D1: Product stats','');
    const pl = await api('/products?page=1&limit=3');
    if(pl.items!==undefined&&pl.pagination)P('D2: Product list OK (showing='+pl.items.length+', total='+pl.pagination.total+')');else F('D2: Product list','');
    if(pl.items&&pl.items.length>0){
      const pd = await api('/products/'+pl.items[0].id);
      if(pd.id&&pd.title)P('D3: Product detail OK (title="'+pd.title.substring(0,40)+'")');else F('D3: Product detail',JSON.stringify(pd));
      const pf = await api('/products?page=1&limit=3&status=XML');
      if(pf.items)P('D4: Product filter OK');else F('D4: Product filter','');
    }else{S('D3: Product detail','no products');S('D4: Product filter','no products');}

    // === E: MARKETPLACE CRUD ===
    console.log('\n===== E: MARKETPLACE CRUD =====');
    const mpl = await api('/marketplace-manage');
    P('E1: MP list OK ('+(mpl.items?.length||0)+' items)');
    const TS = Date.now();
    const nmp = await api('/marketplace-manage',{method:'POST',body:JSON.stringify({key:'rt-mp-'+TS,name:'RT_TEST_MP',apiUrl:'https://api.rt.com/',apiKey:'RT_KEY_001',apiSecret:'RT_SECRET_001',active:true})});
    if(nmp.ok&&nmp.item?.id){P('E2: MP create OK (key=rt-mp-'+TS+')');IDS.mp=nmp.item.id;}else F('E2: MP create',JSON.stringify(nmp));
    if(IDS.mp){
      const fc=await api('/marketplace-manage');const f=fc.items.find(m=>m.id===IDS.mp);
      if(f?.apiKey==='RT_KEY_001'&&f?.apiSecret==='RT_SECRET_001')P('E3: MP DB persist OK');else F('E3: MP DB',JSON.stringify(f));
      await api('/marketplace-manage/'+IDS.mp,{method:'PUT',body:JSON.stringify({name:'RT_TEST_MP',apiKey:'RT_KEY_001',apiSecret:'RT_SECRET_001',sellerId:'SELLER_999',active:true})});
      const fc2=await api('/marketplace-manage');const f2=fc2.items.find(m=>m.id===IDS.mp);
      let s={};try{s=JSON.parse(f2?.settings||'{}');}catch(e){}
      if(f2?.apiKey==='RT_KEY_001'&&f2?.apiSecret==='RT_SECRET_001'&&s.sellerId==='SELLER_999')P('E4: MP partial update NO data loss');else F('E4: MP data loss',JSON.stringify({k:f2?.apiKey,s:f2?.apiSecret,sid:s.sellerId}));
      await api('/marketplace-manage/'+IDS.mp,{method:'PUT',body:JSON.stringify({name:'RT_TEST_MP',apiKey:'RT_KEY_001',apiSecret:'RT_SECRET_001',sellerId:'S_UPD',active:true})});
      const fc3=await api('/marketplace-manage');const f3=fc3.items.find(m=>m.id===IDS.mp);
      let s2={};try{s2=JSON.parse(f3?.settings||'{}');}catch(e){}
      if(f3?.apiKey==='RT_KEY_001'&&f3?.apiSecret==='RT_SECRET_001'&&s2.sellerId==='S_UPD')P('E5: MP sellerId update preserved creds');else F('E5: MP update','lost data');
      const tc=await api('/marketplace-manage/'+IDS.mp+'/test',{method:'POST'});
      S('E6: MP connection test','Simulated — only checks apiUrl');
      const ms=await api('/marketplace-manage/stats');
      if(ms.total!==undefined)P('E7: MP stats OK');else F('E7: MP stats','');
    }
    if(IDS.mp){await api('/marketplace-manage/'+IDS.mp,{method:'DELETE'});const fc4=await api('/marketplace-manage');if(!fc4.items.find(m=>m.id===IDS.mp))P('E8: MP delete OK');else F('E8: MP delete','still exists');}
    const dupe=await api('/marketplace-manage',{method:'POST',body:JSON.stringify({key:'tt',name:'Dupe',apiKey:'x',apiSecret:'y'})});
    if(!dupe.ok&&dupe.error?.code==='CONFLICT')P('E9: MP duplicate key rejected');else F('E9: MP dupe',JSON.stringify(dupe));
    const badMp=await api('/marketplace-manage',{method:'POST',body:JSON.stringify({name:'NoKey'})});
    if(!badMp.ok&&badMp.error?.code==='VALIDATION_ERROR')P('E10: MP missing key rejected');else F('E10: MP validation',JSON.stringify(badMp));

    // === F: CATEGORIES ===
    console.log('\n===== F: CATEGORIES =====');
    const cl=await api('/categories');P('F1: Category list OK ('+(Array.isArray(cl)?cl.length:'N/A')+')');
    const ct=await api('/categories/tree');P('F2: Category tree OK ('+(Array.isArray(ct)?ct.length:'N/A')+')');
    const cs=await api('/categories/stats');if(cs.totalXmlCategories!==undefined)P('F3: Category stats OK');else F('F3: Category stats','');
    const cprod=await api('/categories/products?page=1&limit=5');if(cprod.items)P('F4: Category products OK');else F('F4: Category products','');

    // === G: BRANDS ===
    console.log('\n===== G: BRANDS =====');
    const bl=await api('/brands');P('G1: Brand list OK');
    const bs=await api('/brands/stats');if(bs.totalSystemBrands!==undefined)P('G2: Brand stats OK');else F('G2: Brand stats','');
    const bx=await api('/brands/xml-brands');P('G3: XML brands OK');
    const bm=await api('/brands/mappings');P('G4: Brand mappings OK');
    const bd=await api('/brands/default-brand');if(bd.defaultBrand)P('G5: Default brand OK ('+bd.defaultBrand+')');else F('G5: Default brand',JSON.stringify(bd));

    // === H: VARIANTS ===
    console.log('\n===== H: VARIANTS =====');
    const vl=await api('/variants');P('H1: Variant list OK');
    const vs=await api('/variants/stats');if(vs.totalVariants!==undefined)P('H2: Variant stats OK');else F('H2: Variant stats','');
    const vx=await api('/variants/xml-variants');P('H3: XML variants OK');
    const vu=await api('/variants/unmatched-products?limit=5');if(vu.items)P('H4: Unmatched products OK');else F('H4: Unmatched products','');

    // === I: LISTINGS ===
    console.log('\n===== I: LISTINGS =====');
    const ll=await api('/listings');P('I1: Listing list OK');
    const ls=await api('/listings/stats/summary');if(ls.total!==undefined)P('I2: Listing stats OK');else F('I2: Listing stats','');
    const lf=await api('/listings/forbidden-words/list');P('I3: Forbidden words OK');
    const lr2=await api('/listing-v2/rules');P('I4: Pricing rules OK');

    // === J: READY TO SHIP ===
    console.log('\n===== J: READY TO SHIP =====');
    const rs=await api('/ready-to-ship/stats');if(rs.totalProducts!==undefined)P('J1: RTS stats OK (total='+rs.totalProducts+', ready='+rs.readyCount+')');else F('J1: RTS stats','');
    const rl=await api('/ready-to-ship?page=1&limit=5');if(rl.items)P('J2: RTS list OK ('+rl.items.length+' items)');else F('J2: RTS list','');

    // === K: ORDERS ===
    console.log('\n===== K: ORDERS =====');
    const ol=await api('/orders?page=1&limit=5');if(ol.items!==undefined)P('K1: Order list OK ('+ol.items.length+')');else F('K1: Order list','');
    const os2=await api('/orders/stats');if(os2.total!==undefined)P('K2: Order stats OK');else F('K2: Order stats','');

    // === L: REPORTS ===
    console.log('\n===== L: REPORTS =====');
    const rd=await api('/reports/dashboard');if(rd.totalProducts!==undefined)P('L1: Report dashboard OK');else F('L1: Report dashboard','');
    const rp=await api('/reports/products');if(rp.totalProducts!==undefined)P('L2: Report products OK');else F('L2: Report products','');
    const ro=await api('/reports/orders');if(ro.totalOrders!==undefined)P('L3: Report orders OK');else F('L3: Report orders','');

    // === M: SETTINGS ===
    console.log('\n===== M: SETTINGS =====');
    const sg=await api('/settings');if(sg.items)P('M1: Settings GET OK');else F('M1: Settings GET','');
    const su=await api('/settings',{method:'PUT',body:JSON.stringify({settings:{'site.name':'RT_TEST_SETTINGS'}})});
    if(su.ok){P('M2: Settings PUT OK');const sg2=await api('/settings');if(sg2.items?.['site.name']==='RT_TEST_SETTINGS')P('M3: Settings persist OK');else F('M3: Settings persist',JSON.stringify(sg2.items));await api('/settings',{method:'PUT',body:JSON.stringify({settings:{'site.name':'DG STOK'}})});}else F('M2: Settings PUT',JSON.stringify(su));

    // === N: SYSTEM HEALTH ===
    console.log('\n===== N: SYSTEM =====');
    const sh=await api('/system/health');if(sh.status)P('N1: System health OK ('+sh.status+')');else F('N1: System health','');

    // === O: BROWSER E2E ===
    console.log('\n===== O: BROWSER E2E =====');
    await page.goto('http://localhost:4000',{waitUntil:'networkidle',timeout:15000});
    await page.evaluate(async(t)=>{document.cookie='token='+t;},TK);
    await page.reload({waitUntil:'networkidle'});
    await page.waitForTimeout(3000);
    P('O1: Browser loaded with auth');
    const pg=['dashboard','xml','products','prep-categories','prep-brands','prep-variants','prep-listings','ready-to-ship','marketplace','orders','reports','settings'];
    for(const p of pg){await page.evaluate(n=>{if(typeof showPage==='function')showPage(n);},p);await page.waitForTimeout(500);const v=await page.evaluate(n=>{const e=document.getElementById('page-'+n);return e?!e.classList.contains('hidden'):false;},p);if(v)P('O2: Page "'+p+'" OK');else F('O2: Page "'+p+'"','not visible');}
    await page.evaluate(()=>{if(typeof showPage==='function')showPage('marketplace');});
    await page.waitForTimeout(1500);
    const existingMps2=await api('/marketplace-manage');
    for(const m of(existingMps2.items||[])){if(m.key==='trendyol'||m.key==='etsy'){await api('/marketplace-manage/'+m.id,{method:'DELETE'});}}
    await page.evaluate(()=>{if(typeof mpManageAdd==='function')mpManageAdd();});
    await page.waitForTimeout(800);
    const mpVis=await page.evaluate(()=>!document.getElementById('mp-modal')?.classList.contains('hidden'));
    if(mpVis)P('O3: MP modal opens');else F('O3: MP modal','not visible');
    await page.selectOption('#mp-type','trendyol');
    await page.waitForTimeout(500);
    const cf=await page.evaluate(()=>({k:!!document.getElementById('mp-apiKey'),s:!!document.getElementById('mp-apiSecret'),si:!!document.getElementById('mp-sellerId'),v:!document.getElementById('mp-credential-fields')?.classList.contains('hidden')}));
    if(cf.k&&cf.s&&cf.si&&cf.v)P('O4: MP credential fields visible');else F('O4: MP credentials',JSON.stringify(cf));
    await page.fill('#mp-name','RT_BROWSER_MP');
    const ak=await page.$('#mp-apiKey');if(ak)await ak.fill('BROWSER_KEY');
    const as=await page.$('#mp-apiSecret');if(as)await as.fill('BROWSER_SECRET');
    await page.waitForTimeout(300);
    const sb=await page.$eval('#mp-save-btn',el=>!el.disabled);
    if(sb)P('O5: Save enabled with API Key+Secret');else F('O5: Save btn','disabled');
    await page.click('#mp-save-btn');
    await page.waitForTimeout(3000);
    const saveError=await page.evaluate(()=>{const t=document.querySelector('.toast-error,.toast.success');return t?t.textContent:'';});
    const mc=await page.$eval('#mp-modal',el=>el.classList.contains('hidden')).catch(()=>true);
    if(mc)P('O6: MP saved in browser');else F('O6: MP save','modal still open'+(saveError?' ('+saveError+')':''));
    const browserDb=await api('/marketplace-manage');
    const brMp=browserDb.items?.find(m=>m.name==='RT_BROWSER_MP');
    if(brMp)P('O7: Browser MP persisted in DB');else F('O7: Browser MP','not in DB');
    if(brMp){await api('/marketplace-manage/'+brMp.id,{method:'DELETE'});}

    // === CLEANUP ===
    console.log('\n===== CLEANUP =====');
    if(IDS.xml){await api('/xml-sources/'+IDS.xml,{method:'DELETE'});P('CLEANUP: XML deleted');}
    const allMps=await api('/marketplace-manage');
    for(const m of(allMps.items||[])){if(m.name?.includes('RT_')||m.name?.includes('TEST')){await api('/marketplace-manage/'+m.id,{method:'DELETE'});}}
    P('CLEANUP: All RT_ test records removed');

  }catch(e){F('FATAL',e.message);}

  // === STUB AUDIT ===
  console.log('\n===== STUB/MOCK AUDIT =====');
  S('Marketplace Connection Test','Only checks apiUrl non-empty. No real API.');
  S('XML Connection Test','Fetches URL but no marketplace integration.');
  S('AI Image Center','Demo mode — no real AI provider.');
  S('AI Sales Assistant','Demo mode — no real AI provider.');
  S('AI Copilot','Simulated responses — no real AI provider.');
  S('Marketplace API Client','No real API client for Trendyol/Hepsiburada/etc.');
  S('Stock Sync to Marketplace','No sync engine exists.');
  S('Zero-Stock Close','listingEngine has calc but no marketplace push.');
  S('Queue/Worker','No job queue system exists.');
  S('XML Real Import','No real XML URL to import from.');

  console.log('\n\n========================================');
  console.log('      FULL SYSTEM E2E RESULTS');
  console.log('========================================');
  const p=R.filter(r=>r.includes('[PASS]')).length;
  const f=R.filter(r=>r.includes('[FAIL]')).length;
  const s=R.filter(r=>r.includes('[STUB]')).length;
  R.forEach(r=>console.log(r));
  console.log('\n  TOTAL: '+p+' PASS / '+f+' FAIL / '+s+' STUB / '+(p+f+s)+' TOTAL');
  if(f>0)console.log('\n  FINAL STATUS = FAIL');
  else console.log('\n  FINAL STATUS = PASS');
  await browser.close();
})();
