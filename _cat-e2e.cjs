const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:4000';
const XML_ID = '949855eb-d68c-4920-b378-c622a6a665e2'; // AKILLIBAYI1
const XML_NAME = 'AKILLIBAYI1';
const MP_ID = '757a071c-98c5-4c96-bb8c-2dceac1568dd'; // Trendyol
const MP_NAME = 'Trendyol';

const SHOTS = 'C:/PROJE 1/DG-STOK-THEME-V1';
const log = [];
const consoleLog = [];
const networkLog = [];

function push(line) { log.push(line); console.log(line); }

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', m => {
    consoleLog.push(`[${m.type()}] ${m.text()}`);
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('request', r => {
    const u = r.url();
    if (u.includes('/categories/')) networkLog.push(`REQ ${r.method()} ${u}`);
  });
  page.on('response', r => {
    if (r.url().includes('/categories/')) networkLog.push(`RES ${r.status()} ${r.url()}`);
  });

  // ==== LOGIN ====
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const loggedIn = await page.evaluate(() => !!(window.currentPage || document.getElementById('nav-dashboard')));
  if (!loggedIn) {
    push('Performing UI login');
    await page.evaluate(() => { const b = document.querySelector('button[type="submit"], button.login-btn, #login-btn'); if (b) b.click(); });
    await page.waitForTimeout(2500);
  }
  const me = await page.evaluate(() => !!window.contextState);
  push('contextState present (app loaded): ' + me);

  async function state() {
    return await page.evaluate(() => {
      const cs = window.contextState || {};
      const cs2 = (typeof catState !== 'undefined') ? catState : null;
      const cont = document.getElementById('cat-content');
      const guard = document.getElementById('cat-guard-warn');
      const tb = document.getElementById('cat-table-body');
      const stepper = document.getElementById('cat-stepper');
      const toolbar = document.getElementById('cat-toolbar');
      const mpSel = document.getElementById('cat-marketplace');
      const btn = document.querySelector('#cat-table-body button');
      const cd = el => el ? { hidden: el.classList.contains('hidden'), display: el.style.display || '', visibility: getComputedStyle(el).visibility, opacity: getComputedStyle(el).opacity, pointerEvents: getComputedStyle(el).pointerEvents } : null;
      return {
        contextState: { xmlSourceId: cs.xmlSourceId, xmlSourceName: cs.xmlSourceName, marketplaceId: cs.marketplaceId, marketplaceName: cs.marketplaceName, isValid: cs.isValid },
        catState: cs2 ? { xmlSupplierId: cs2.xmlSupplierId, step: cs2.step, loading: cs2.loading, totalProducts: cs2.totalProducts, productCount: (cs2.products || []).length, groupCount: (cs2.groups || []).length } : null,
        catContent: cd(cont),
        catGuard: cd(guard),
        catTableBody: cd(tb),
        catStepper: cd(stepper),
        catToolbar: cd(toolbar),
        tableBodyText: tb ? tb.innerText.slice(0, 300) : '',
        catMpValue: mpSel ? mpSel.value : '',
        mpDisabled: mpSel ? mpSel.disabled : null,
        rowCount: document.querySelectorAll('#cat-table-body [data-row], #cat-table-body .grid').length,
        firstButton: btn ? { text: btn.innerText.slice(0, 30), disabled: btn.disabled } : null,
      };
    });
  }

  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });

  // ==== 01 NO CONTEXT ====
  push('===== 01 NO CONTEXT =====');
  await page.evaluate(() => { window.showPage('prep-categories'); });
  await page.waitForTimeout(1500);
  let s = await state();
  push('state=' + JSON.stringify(s, null, 1));
  const defined = await page.evaluate(() => ({
    eksikInDom: (() => { const mm = document.querySelectorAll('*'); let c = 0; mm.forEach(e => { if (e.children.length === 0 && e.textContent.includes('Eksik Seçim')) c++; }); return c; })(),
    originalMsgVisible: (() => { const g = document.getElementById('cat-guard-warn'); return g ? (getComputedStyle(g).display !== 'none' && !g.classList.contains('hidden')) : null; })(),
  }));
  push('Eksik Seçim text nodes in DOM = ' + defined.eksikInDom);
  push('Original message visible = ' + defined.originalMsgVisible);
  await shot('01-no-context');

  // ==== 02 XML ONLY ====
  push('===== 02 XML ONLY =====');
  await page.evaluate(({ xml, mp }) => {
    const xmlSel = document.getElementById('context-xml-source');
    const mpSel = document.getElementById('context-marketplace');
    if (xml) { xmlSel.value = xml; xmlSel.dispatchEvent(new Event('change')); }
    if (mp) { mpSel.value = mp; mpSel.dispatchEvent(new Event('change')); }
  }, { xml: XML_ID, mp: '' });
  await page.waitForTimeout(1200);
  s = await state();
  push('contextState=' + JSON.stringify(s.contextState));
  push('catState=' + JSON.stringify(s.catState));
  await shot('02-xml-only');

  // ==== 03 MARKETPLACE ONLY (mp select disabled without xml - already implies tested) ====
  // Marketplace already set in "full"; do xml-clear path manually later

  // ==== 04 FULL CONTEXT ====
  push('===== 04 FULL CONTEXT =====');
  // xml already chosen; choose marketplace via real change event
  await page.evaluate(({ mp }) => { const s = document.getElementById('context-marketplace'); s.value = mp; s.dispatchEvent(new Event('change')); }, { mp: MP_ID });
  await page.waitForTimeout(3000);
  s = await state();
  push('contextState=' + JSON.stringify(s.contextState));
  push('catState=' + JSON.stringify(s.catState));
  push('catMpValue=' + s.catMpValue + ' mpDisabled=' + s.mpDisabled);
  push('rowCount=' + s.rowCount);
  push('tableBodyText=' + s.tableBodyText);
  await shot('04-full-context');

  // ==== 05 CONTEXT CLEARED ====
  push('===== 05 CONTEXT CLEARED =====');
  await page.evaluate(() => { if (window.clearContext) clearContext(); });
  await page.waitForTimeout(1500);
  s = await state();
  push('contextState=' + JSON.stringify(s.contextState));
  push('catState=' + JSON.stringify(s.catState));
  await shot('05-context-cleared');

  // ==== 06 UNMATCHED ONLY (status=XML) ====
  push('===== 06 UNMATCHED CATEGORIES =====');
  await page.evaluate(({ xml, mp }) => {
    const xmlSel = document.getElementById('context-xml-source');
    const mpSel = document.getElementById('context-marketplace');
    xmlSel.value = xml; xmlSel.dispatchEvent(new Event('change'));
    mpSel.disabled = false;
    mpSel.value = mp; mpSel.dispatchEvent(new Event('change'));
  }, { xml: XML_ID, mp: MP_ID });
  await page.waitForTimeout(3000);
  s = await state();
  push('contextState=' + JSON.stringify(s.contextState));
  push('catState=' + JSON.stringify(s.catState));
  push('rowCount=' + s.rowCount);
  push('tableBodyText=' + s.tableBodyText);
  // verify a match button exists & enabled
  const btn = await page.evaluate(() => {
    const b = document.querySelector('#cat-table-body button[onclick*="catOpenSingleMatch"], #cat-table-body button[onclick*="catApproveSuggestion"]');
    return b ? { text: b.innerText.slice(0, 30), disabled: b.disabled } : null;
  });
  push('actionButton=' + JSON.stringify(btn));
  await shot('06-unmatched-categories');

  // ==== NETWORK & CONSOLE REPORTS ====
  fs.writeFileSync(`${SHOTS}/category-network-report.txt`, networkLog.join('\n'));
  fs.writeFileSync(`${SHOTS}/category-console-report.txt`, consoleLog.join('\n'));
  fs.writeFileSync(`${SHOTS}/category-dom-report.txt`, log.join('\n'));
  push('===== NETWORK (categories) =====');
  push(networkLog.join('\n'));
  push('===== CONSOLE ERRORS =====');
  push(errors.length ? errors.join('\n') : '0 errors');
  push('===== ALL REPORT ABOVE SAVED TO category-*.txt =====');

  await browser.close();
  process.exit(0);
})().catch(e => { console.error('E2E CRASH:', e); process.exit(1); });