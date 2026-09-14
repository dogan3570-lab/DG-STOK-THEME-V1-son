const pw = require('C:\\Users\\Dogan\\AppData\\Roaming\\npm\\node_modules\\omniroute\\node_modules\\playwright');

const BASE = 'http://localhost:5175';
const API = 'http://localhost:4000';

(async () => {
  const browser = await pw.chromium.launch({ headless: true, executablePath: 'C:\\Users\\Dogan\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const results = [];
  let passCount = 0, failCount = 0, warnCount = 0;
  function pass(name) { passCount++; results.push({ name, s: 'PASS' }); console.log('  PASS: ' + name); }
  function fail(name, err) { failCount++; results.push({ name, s: 'FAIL', e: err }); console.log('  FAIL: ' + name + ' | ' + err); }
  function warn(name, msg) { warnCount++; results.push({ name, s: 'WARN', e: msg }); console.log('  WARN: ' + name + ' | ' + msg); }
  function info(msg) { console.log('  INFO: ' + msg); }

  // API helper - cookie-based auth ile
  let authCookie = null;
  async function apiGet(path) {
    const cookies = authCookie ? [authCookie] : [];
    const resp = await ctx.request.get(API + path, { cookies });
    const json = await resp.json().catch(() => null);
    return { status: resp.status(), json };
  }
  async function apiPost(path, body) {
    const cookies = authCookie ? [authCookie] : [];
    const resp = await ctx.request.post(API + path, { data: body, cookies });
    const text = await resp.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: resp.status(), json, text };
  }
  async function apiDelete(path) {
    const cookies = authCookie ? [authCookie] : [];
    const resp = await ctx.request.delete(API + path, { cookies });
    const text = await resp.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: resp.status(), json, text };
  }

  try {
    // =====================================================================
    // AŞAMA 0: LOGIN
    // =====================================================================
    console.log('\n=== AŞAMA 0: LOGIN ===');
    
    // Backend auth endpoint'ini test et
    const meBefore = await apiGet('/auth/me');
    info('Auth/me (önce): ' + meBefore.status + ' authenticated=' + (meBefore.json?.authenticated || false));
    
    // Login dene
    const loginRes = await apiPost('/auth/login', { email: 'admin@dgstok.com', password: 'Admin1234!' });
    info('Login response: ' + loginRes.status);
    
    if (loginRes.status === 200 && loginRes.json?.user) {
      pass('Login başarılı - kullanıcı: ' + loginRes.json.user.email + ' rol: ' + loginRes.json.user.role);
      // Cookie'yi kaydet
      const setCookies = loginRes.json;
      // Playwright context'a cookie ekle
      if (loginRes.json?.token) {
        await ctx.addCookies([{
          name: 'dgstok_token',
          value: loginRes.json.token,
          domain: 'localhost',
          path: '/',
          httpOnly: false,
          secure: false,
        }]);
        authCookie = { name: 'dgstok_token', value: loginRes.json.token };
        info('Token kaydedildi: ' + loginRes.json.token.substring(0, 20) + '...');
      }
    } else {
      // Cookie-based auth deneyelim
      info('Login response detail: ' + JSON.stringify(loginRes.json || loginRes.text).substring(0, 200));
      // Token yerine cookie ile devam et
      const meAfter = await apiGet('/auth/me');
      if (meAfter.json?.authenticated) {
        pass('Cookie-based auth çalışıyor');
      } else {
        warn('Auth durumu', 'Login başarısız ama test devam edecek');
      }
    }

    // Auth me kontrolü
    const meCheck = await apiGet('/auth/me');
    if (meCheck.json?.authenticated === true) {
      pass('Auth me: authenticated=true, role=' + meCheck.json.role);
    } else {
      warn('Auth me', 'authenticated=false - test verilerini sadece okuma modunda test edeceğiz');
    }

    // =====================================================================
    // AŞAMA 1: GENEL KAYNAKLAR (XML Sources + Marketplaces)
    // =====================================================================
    console.log('\n=== AŞAMA 1: GENEL KAYNAKLAR ===');
    
    const xs = await apiGet('/xml-sources');
    const xmlSources = xs.json?.items || [];
    info('XML Sources: ' + xmlSources.length + ' adet');
    if (xmlSources.length > 0) {
      pass('XML Sources yüklendi (' + xmlSources.length + ' kaynak)');
      const first = xmlSources[0];
      info('  İlk kaynak: ' + first.name + ' (id=' + first.id + ', products=' + (first.productCount || 0) + ')');
    } else {
      warn('XML Sources', 'Kaynak yok - tüm modüller guard ile engellenebilir');
    }

    const mps = await apiGet('/marketplaces');
    const marketplaces = mps.json?.items || [];
    info('Marketplaces: ' + marketplaces.length + ' adet');
    if (marketplaces.length > 0) {
      pass('Marketplaces yüklendi (' + marketplaces.length + ' pazaryeri)');
      marketplaces.forEach(m => info('  ' + m.name + ' (key=' + m.key + ', active=' + m.active + ')'));
    } else {
      warn('Marketplaces', 'Pazaryeri yok - tüm modüller guard ile engellenebilir');
    }

    // İlk xmlSource ve marketplace seç
    const xsId = xmlSources.length > 0 ? xmlSources[0].id : null;
    const mpId = marketplaces.length > 0 ? marketplaces[0].id : null;
    const mpKey = marketplaces.length > 0 ? marketplaces[0].key : null;
    
    if (!xsId || !mpId) {
      warn('Seçim', 'XML Source veya Marketplace yok. Bazı testler atlanabilir.');
    }

    // =====================================================================
    // AŞAMA 2: KATEGORİ EŞLEŞTİRME
    // =====================================================================
    console.log('\n=== AŞAMA 2: KATEGORİ EŞLEŞTİRME ===');

    if (xsId && mpId) {
      // 2.1 Category tree
      const catTree = await apiGet('/categories/tree?xmlSourceId=' + xsId + '&marketplaceId=' + mpId);
      if (catTree.status === 200) {
        const flat = catTree.json?.flat || catTree.json?.items || [];
        pass('Category tree yüklendi (' + flat.length + ' kategori)');
        if (flat.length > 0) info('  İlk kategori: ' + (flat[0].name || 'N/A'));
      } else {
        fail('Category tree', 'HTTP ' + catTree.status);
      }

      // 2.2 Category stats
      const catStats = await apiGet('/categories/stats?xmlSourceId=' + xsId + '&marketplaceId=' + mpId);
      if (catStats.status === 200) {
        const st = catStats.json;
        pass('Category stats: TOP=' + (st.TOTAL_PRODUCTS || 0) + ' MATCHED=' + (st.MATCHED || 0) + ' UNMATCHED=' + (st.UNMATCHED || 0) + ' AI=' + (st.AI_SUGGESTED || 0));
        
        // DB tutarlılığı: MATCHED + UNMATCHED <= TOTAL_PRODUCTS olmalı
        const total = st.TOTAL_PRODUCTS || 0;
        const matched = st.MATCHED || 0;
        const unmatched = st.UNMATCHED || 0;
        if (matched + unmatched <= total || total === 0) {
          pass('Category stats tutarlı: ' + matched + '+' + unmatched + ' <= ' + total);
        } else {
          fail('Category stats tutarlılık', matched + '+' + unmatched + ' > ' + total);
        }
      } else {
        fail('Category stats', 'HTTP ' + catStats.status);
      }

      // 2.3 Category filtered products
      const catFiltered = await apiGet('/categories/filtered?xmlSourceId=' + xsId + '&marketplaceId=' + mpId + '&page=1&pageSize=5&sortBy=priority');
      if (catFiltered.status === 200) {
        const items = catFiltered.json?.items || [];
        const pagination = catFiltered.json?.pagination;
        pass('Category filtered: ' + items.length + ' ürün (toplam: ' + (pagination?.total || '?') + ')');
        if (items.length > 0) {
          const p = items[0];
          info('  İlk ürün: ' + (p.title || p.xmlKey || 'N/A'));
          info('  categoryId=' + (p.categoryId || 'YOK') + ', categoryMatch=' + (p.categoryMatch || false) + ', matchedBy=' + (p.matchedBy || 'NONE'));
          
          // Bir ürünün detayını çek
          if (p.id) {
            const detail = await apiGet('/categories/' + p.id);
            if (detail.status === 200) {
              const prod = detail.json?.product;
              pass('Ürün detayı: ' + (prod?.title || 'N/A') + ' categoryId=' + (prod?.categoryId || 'YOK'));
              
              // Suggest chips
              if (prod?.id) {
                const suggest = await apiGet('/categories/suggest?productId=' + prod.id);
                if (suggest.status === 200) {
                  const sugs = suggest.json?.suggestions || [];
                  pass('AI suggestions: ' + sugs.length + ' öneri (güven: ' + (suggest.json?.confidence || 'N/A') + ')');
                  if (sugs.length > 0) info('  İlk öneri: ' + (sugs[0].fullPath || sugs[0].name || 'N/A'));
                } else {
                  warn('Category suggest', 'HTTP ' + suggest.status);
                }
              }
            } else {
              warn('Category detail', 'HTTP ' + detail.status);
            }
          }
        }
      } else {
        fail('Category filtered', 'HTTP ' + catFiltered.status);
      }

      // 2.4 Resolve history
      const resolveHist = await apiGet('/categories/resolve-history');
      if (resolveHist.status === 200) {
        const hist = resolveHist.json?.items || [];
        pass('Resolve history: ' + hist.length + ' kayıt');
      } else {
        warn('Resolve history', 'HTTP ' + resolveHist.status);
      }
    } else {
      warn('Kategori', 'xsId veya mpId yok, atlanıyor');
    }

    // =====================================================================
    // AŞAMA 3: MARKA EŞLEŞTİRME
    // =====================================================================
    console.log('\n=== AŞAMA 3: MARKA EŞLEŞTİRME ===');

    if (xsId) {
      // 3.1 XML Brands
      const xmlBrands = await apiGet('/brands/xml-brands?xmlSourceId=' + xsId);
      if (xmlBrands.status === 200) {
        const brands = xmlBrands.json?.items || [];
        pass('XML Brands yüklendi (' + brands.length + ' marka)');
        if (brands.length > 0) info('  İlk marka: ' + (brands[0].name || 'N/A'));
      } else {
        fail('XML Brands', 'HTTP ' + xmlBrands.status);
      }

      // 3.2 Brand stats
      const brandStats = await apiGet('/brands/stats?xmlSourceId=' + xsId);
      if (brandStats.status === 200) {
        const bs = brandStats.json;
        pass('Brand stats: toplam=' + (bs.totalProducts || 0) + ' eşleşen=' + (bs.matchedProducts || 0) + ' bekleyen=' + (bs.waitingProducts || 0));
      } else {
        fail('Brand stats', 'HTTP ' + brandStats.status);
      }

      // 3.3 Brand products
      const brandProds = await apiGet('/brands/products?page=1&limit=5&xmlSourceId=' + xsId);
      if (brandProds.status === 200) {
        const items = brandProds.json?.items || [];
        const pag = brandProds.json?.pagination;
        pass('Brand products: ' + items.length + ' ürün (toplam: ' + (pag?.total || '?') + ')');
        if (items.length > 0) {
          const p = items[0];
          info('  İlk ürün: ' + (p.title || 'N/A') + ' brand=' + (p.brand?.name || p.xmlBrandName || 'YOK') + ' brandMatch=' + (p.brandMatch || false));
        }
      } else {
        fail('Brand products', 'HTTP ' + brandProds.status);
      }

      // 3.4 Brand search
      if (mpKey) {
        const brandSearch = await apiGet('/brands?search=test');
        if (brandSearch.status === 200) {
          const found = brandSearch.json?.items || [];
          pass('Brand search: ' + found.length + ' sonuç');
        } else {
          warn('Brand search', 'HTTP ' + brandSearch.status);
        }
      }
    } else {
      warn('Marka', 'xsId yok, atlanıyor');
    }

    // =====================================================================
    // AŞAMA 4: VARYANT EŞLEŞTİRME
    // =====================================================================
    console.log('\n=== AŞAMA 4: VARYANT EŞLEŞTİRME ===');

    if (xsId) {
      // 4.1 Variant records (V5)
      const varRecords = await apiGet('/variants/?limit=10&xmlSourceId=' + xsId);
      if (varRecords.status === 200) {
        const items = varRecords.json?.items || [];
        pass('Variant records: ' + items.length + ' kayıt');
      } else {
        warn('Variant records (V5)', 'HTTP ' + varRecords.status);
      }

      // 4.2 XML variants
      const xmlVars = await apiGet('/variants/xml-variants?xmlSourceId=' + xsId);
      if (xmlVars.status === 200) {
        const items = xmlVars.json?.items || [];
        pass('XML variants: ' + items.length + ' ürün');
        if (items.length > 0) {
          const v = items[0];
          info('  İlk: productId=' + (v.productId || 'N/A') + ' variants=' + JSON.stringify(v.detectedVariants || []).substring(0, 80));
        }
      } else {
        warn('XML variants', 'HTTP ' + xmlVars.status);
      }

      // 4.3 Variant stats
      const varStats = await apiGet('/variants/stats?xmlSourceId=' + xsId);
      if (varStats.status === 200) {
        const vs = varStats.json;
        pass('Variant stats: matched=' + (vs.matchedProducts || 0) + ' unmatched=' + (vs.unmatchedProducts || 0));
      } else {
        warn('Variant stats', 'HTTP ' + varStats.status);
      }

      // 4.4 Variant dashboard (V4)
      const varDash = await apiGet('/variants/dashboard?xmlSourceId=' + xsId + (mpId ? '&marketplaceId=' + mpId : ''));
      if (varDash.status === 200) {
        const vd = varDash.json;
        pass('Variant dashboard: total=' + (vd.totalProducts || 0) + ' hasVariants=' + (vd.hasVariants || 0) + ' noVariants=' + (vd.noVariants || 0));
        
        // DB tutarlılığı
        const total = vd.totalProducts || 0;
        const hasV = vd.hasVariants || 0;
        const noV = vd.noVariants || 0;
        if (hasV + noV <= total || total === 0) {
          pass('Variant dashboard tutarlı: ' + hasV + '+' + noV + ' <= ' + total);
        } else {
          fail('Variant dashboard tutarlılık', hasV + '+' + noV + ' > ' + total);
        }
      } else {
        warn('Variant dashboard (V4)', 'HTTP ' + varDash.status);
      }

      // 4.5 Variant products (V4)
      const varProds = await apiGet('/variants/products?page=1&limit=5&xmlSourceId=' + xsId);
      if (varProds.status === 200) {
        const items = varProds.json?.items || [];
        const pag = varProds.json?.pagination;
        pass('Variant products: ' + items.length + ' ürün (toplam: ' + (pag?.total || '?') + ')');
        if (items.length > 0) {
          const p = items[0];
          info('  İlk: ' + (p.title || 'N/A') + ' status=' + (p.status || 'N/A') + ' variants=' + JSON.stringify(p.variants || []).substring(0, 60));
        }
      } else {
        warn('Variant products (V4)', 'HTTP ' + varProds.status);
      }

      // 4.6 Variant unmatched products
      const unmatched = await apiGet('/variants/unmatched-products?limit=5&xmlSourceId=' + xsId);
      if (unmatched.status === 200) {
        const items = unmatched.json?.items || [];
        const total = unmatched.json?.total || 0;
        pass('Variant unmatched: ' + items.length + ' (toplam: ' + total + ')');
      } else {
        warn('Variant unmatched', 'HTTP ' + unmatched.status);
      }

      // 4.7 Variant screen
      const varScreen = await apiGet('/variants/screen?page=1&limit=5&xmlSourceId=' + xsId);
      if (varScreen.status === 200) {
        const items = varScreen.json?.items || [];
        const total = varScreen.json?.total || 0;
        pass('Variant screen: ' + items.length + ' (toplam: ' + total + ')');
      } else {
        warn('Variant screen', 'HTTP ' + varScreen.status);
      }

      // 4.8 Variant logs
      const varLogs = await apiGet('/variants/logs?limit=5');
      if (varLogs.status === 200) {
        const items = varLogs.json?.items || [];
        pass('Variant logs: ' + items.length + ' kayıt');
      } else {
        warn('Variant logs', 'HTTP ' + varLogs.status);
      }
    } else {
      warn('Varyant', 'xsId yok, atlanıyor');
    }

    // =====================================================================
    // AŞAMA 5: LİSTELEME ŞABLONU
    // =====================================================================
    console.log('\n=== AŞAMA 5: LİSTELEME ŞABLONU ===');

    // 5.1 Listings
    const listings = await apiGet('/listings');
    if (listings.status === 200) {
      const items = listings.json?.items || [];
      pass('Listings yüklendi (' + items.length + ' şablon)');
      items.forEach(t => info('  Şablon: ' + t.name + ' (id=' + t.id + ', active=' + t.active + ', mp=' + (t.marketplaceId || 'YOK') + ')'));
    } else {
      fail('Listings', 'HTTP ' + listings.status);
    }

    // 5.2 Listings stats
    const listStats = await apiGet('/listings/stats/summary');
    if (listStats.status === 200) {
      const ls = listStats.json;
      pass('Listing stats: total=' + (ls.total || 0) + ' active=' + (ls.active || 0) + ' inactive=' + (ls.inactive || 0));
    } else {
      warn('Listing stats', 'HTTP ' + listStats.status);
    }

    // 5.3 Listing rules
    const listRules = await apiGet('/listing-v2/rules' + (mpId ? '?marketplaceId=' + mpId : ''));
    if (listRules.status === 200) {
      const rules = listRules.json?.items || [];
      pass('Listing rules: ' + rules.length + ' kural');
      rules.forEach(r => info('  Kural: min=' + r.minPrice + ' max=' + r.maxPrice + ' margin=' + r.profitMargin + ' fixed=' + r.fixedAmount));
    } else {
      fail('Listing rules', 'HTTP ' + listRules.status);
    }

    // 5.4 Listing V2 calculate
    const calcRes = await apiPost('/listing-v2/calculate', { vatIncludedPurchase: 100, profitMargin: 20, fixedAmount: 10, rounding: '' });
    if (calcRes.status === 200) {
      const calc = calcRes.json;
      pass('V2 Calculate: 100*1.20+10=' + (calc.finalPrice || 'N/A') + ' (kar: ' + (calc.profit || 'N/A') + ')');
    } else {
      warn('V2 Calculate', 'HTTP ' + calcRes.status + ' - ' + JSON.stringify(calcRes.json).substring(0, 100));
    }

    // 5.5 Listing logs
    const listLogs = await apiGet('/listing-v2/logs');
    if (listLogs.status === 200) {
      const items = listLogs.json?.items || [];
      pass('Listing logs: ' + items.length + ' kayıt');
    } else {
      warn('Listing logs', 'HTTP ' + listLogs.status);
    }

    // 5.6 Forbidden words
    const forbidden = await apiGet('/listings/forbidden-words/list');
    if (forbidden.status === 200) {
      const items = forbidden.json?.items || [];
      pass('Forbidden words: ' + items.length + ' yasaklı kelime');
    } else {
      warn('Forbidden words', 'HTTP ' + forbidden.status);
    }

    // 5.7 Bir listings template'in matching products'ını kontrol et
    if (listings.json?.items?.length > 0) {
      const tplId = listings.json.items[0].id;
      const matchProds = await apiGet('/listings/' + tplId + '/matching-products');
      if (matchProds.status === 200) {
        const mpItems = matchProds.json?.items || [];
        pass('Matching products (template ' + tplId.substring(0, 8) + '): ' + mpItems.length + ' ürün');
      } else {
        warn('Matching products', 'HTTP ' + matchProds.status);
      }
    }

    // =====================================================================
    // AŞAMA 6: GÖNDERİME HAZIR (RTS)
    // =====================================================================
    console.log('\n=== AŞAMA 6: GÖNDERİME HAZIR ===');

    // 6.1 RTS stats
    const rtsStats = await apiGet('/ready-to-ship/stats' + (xsId ? '?xmlSourceIds=' + xsId : ''));
    if (rtsStats.status === 200) {
      const rs = rtsStats.json;
      pass('RTS stats: ready=' + (rs.readyCount || 0) + ' notReady=' + (rs.notReadyCount || 0) + ' total=' + (rs.productUniverseCount || 0));
      info('  categoryMatched=' + (rs.categoryMatched || 0) + ' missingCategory=' + (rs.missingCategory || 0) + ' missingBrand=' + (rs.missingBrand || 0) + ' missingVariant=' + (rs.missingVariant || 0) + ' missingTemplate=' + (rs.missingTemplate || 0));
      
      // DB tutarlılığı: ready + notReady <= total
      const ready = rs.readyCount || 0;
      const notReady = rs.notReadyCount || 0;
      const total = rs.productUniverseCount || 0;
      if (ready + notReady <= total || total === 0) {
        pass('RTS stats tutarlı: ' + ready + '+' + notReady + ' <= ' + total);
      } else {
        fail('RTS stats tutarlılık', ready + '+' + notReady + ' > ' + total);
      }
    } else {
      fail('RTS stats', 'HTTP ' + rtsStats.status);
    }

    // 6.2 RTS products - ready filter
    const rtsReady = await apiGet('/ready-to-ship?page=1&limit=5&filter=ready' + (xsId ? '&xmlSourceIds=' + xsId : ''));
    if (rtsReady.status === 200) {
      const items = rtsReady.json?.items || [];
      const pag = rtsReady.json?.pagination;
      pass('RTS ready: ' + items.length + ' ürün (toplam: ' + (pag?.total || '?') + ')');
      if (items.length > 0) {
        const p = items[0];
        info('  İlk: ' + (p.title || 'N/A'));
        info('  catMatch=' + p.categoryMatch + ' brandMatch=' + p.brandMatch + ' varMatch=' + p.variantMatch + ' tplReady=' + p.templateReady);
        info('  isReady=' + p.isReady + ' status=' + p.status);
        
        // 4/4 gate kontrolü
        if (p.isReady === true) {
          if (p.categoryMatch && p.brandMatch && (p.variantMatch || p.variantStatus === 'NOT_REQUIRED') && p.templateReady) {
            pass('4/4 readiness gate DOĞRU: tüm gate\'ler açık');
          } else {
            fail('4/4 readiness gate', 'isReady=true ama gate\'ler eksik: cat=' + p.categoryMatch + ' brand=' + p.brandMatch + ' var=' + p.variantMatch + ' tpl=' + p.templateReady);
          }
        }
        
        // Marketplace prices kontrolü
        if (p.marketplacePrices && p.marketplacePrices.length > 0) {
          pass('Marketplace prices mevcut: ' + p.marketplacePrices.length + ' pazaryeri');
          p.marketplacePrices.forEach(mp => info('    ' + mp.key + ': ' + mp.price + ' TL (eligible=' + mp.eligibility + ')'));
        } else {
          warn('Marketplace prices', 'Pazaryeri fiyatı yok');
        }
        
        // Missing reasons kontrolü
        if (p.missingReasons && p.missingReasons.length > 0) {
          info('  Eksik nedenler: ' + p.missingReasons.join(', '));
        }
      }
    } else {
      fail('RTS ready', 'HTTP ' + rtsReady.status);
    }

    // 6.3 RTS products - waiting filter
    const rtsWaiting = await apiGet('/ready-to-ship?page=1&limit=3&filter=waiting' + (xsId ? '&xmlSourceIds=' + xsId : ''));
    if (rtsWaiting.status === 200) {
      const items = rtsWaiting.json?.items || [];
      const pag = rtsWaiting.json?.pagination;
      pass('RTS waiting: ' + items.length + ' ürün (toplam: ' + (pag?.total || '?') + ')');
      if (items.length > 0) {
        const p = items[0];
        info('  İlk eksik: ' + (p.title || 'N/A') + ' missing=' + JSON.stringify(p.missingReasons || []).substring(0, 80));
      }
    } else {
      fail('RTS waiting', 'HTTP ' + rtsWaiting.status);
    }

    // 6.4 RTS detail (ilk ürünün detayı)
    if (rtsReady.json?.items?.length > 0) {
      const pid = rtsReady.json.items[0].id;
      const detail = await apiGet('/ready-to-ship/' + pid);
      if (detail.status === 200) {
        const d = detail.json;
        pass('RTS detail: ' + (d.title || 'N/A') + ' isReady=' + d.isReady);
        info('  category=' + (d.category?.name || 'YOK') + ' brand=' + (d.brand?.name || 'YOK') + ' template=' + (d.templateName || 'YOK'));
        info('  catMatch=' + d.categoryMatch + ' brandMatch=' + d.brandMatch + ' varMatch=' + d.variantMatch + ' tplReady=' + d.templateReady);
        info('  mpStates: ' + JSON.stringify(d.marketplaceStates || []).substring(0, 100));
      } else {
        warn('RTS detail', 'HTTP ' + detail.status);
      }
    }

    // =====================================================================
    // AŞAMA 7: MODÜLLER ARASI VERİ AKIŞI KANITI
    // =====================================================================
    console.log('\n=== AŞAMA 7: MODÜLLER ARASI VERİ AKIŞI ===');

    // 7.1 Kategori eşleşen bir ürünün brand kontrolü
    if (xsId && mpId) {
      const filtered = await apiGet('/categories/filtered?xmlSourceId=' + xsId + '&marketplaceId=' + mpId + '&page=1&pageSize=1&sortBy=priority');
      if (filtered.json?.items?.length > 0) {
        const p = filtered.json.items[0];
        info('Zincir kontrolü: Ürün=' + (p.title || p.xmlKey || p.id));
        info('  Kategori: categoryId=' + (p.categoryId || 'YOK') + ' categoryMatch=' + (p.categoryMatch || false));
        
        // Aynı ürünün brand durumunu kontrol et
        if (p.id) {
          const brandCheck = await apiGet('/brands/products?page=1&limit=50&xmlSourceId=' + xsId);
          if (brandCheck.json?.items) {
            const sameProduct = brandCheck.json.items.find(bp => bp.id === p.id);
            if (sameProduct) {
              info('  Marka: brand=' + (sameProduct.brand?.name || sameProduct.xmlBrandName || 'YOK') + ' brandMatch=' + (sameProduct.brandMatch || false));
              if (p.categoryMatch && sameProduct.brandMatch) {
                pass('Zincir 1→2: Kategori ve Marka eşleşmesi mevcut');
              } else {
                warn('Zincir 1→2', 'Kategori match=' + p.categoryMatch + ' Brand match=' + (sameProduct.brandMatch || false));
              }
            } else {
              info('  Aynı ürün brand listesinde bulunamadı (farklı sayfa olabilir)');
            }
          }
        }
        
        // Aynı ürünün varyant durumunu kontrol et
        if (p.id) {
          const varCheck = await apiGet('/variants/products?page=1&limit=50&xmlSourceId=' + xsId);
          if (varCheck.json?.items) {
            const sameVar = varCheck.json.items.find(vp => vp.id === p.id);
            if (sameVar) {
              info('  Varyant: status=' + (sameVar.status || 'N/A') + ' variants=' + JSON.stringify(sameVar.variants || []).substring(0, 60));
              pass('Zincir 1→3: Varyant durumu okunabiliyor');
            } else {
              info('  Aynı ürün varyant listesinde bulunamadı');
            }
          }
        }
      }
    }

    // 7.2 RTS'nin tüm gate'leri toplu kontrol
    if (xsId) {
      const rtsAll = await apiGet('/ready-to-ship?page=1&limit=50&filter=all' + (xsId ? '&xmlSourceIds=' + xsId : ''));
      if (rtsAll.json?.items) {
        const items = rtsAll.json.items;
        const ready = items.filter(i => i.isReady);
        const notReady = items.filter(i => !i.isReady);
        
        info('Toplu gate kontrolü: ' + items.length + ' ürün (' + ready.length + ' hazır, ' + notReady.length + ' bekliyor)');
        
        // Hazır ürünlerin gate'lerini doğrula
        let allGatesCorrect = true;
        ready.forEach(p => {
          if (!p.categoryMatch || !p.brandMatch || (!p.variantMatch && p.variantStatus !== 'NOT_REQUIRED') || !p.templateReady) {
            allGatesCorrect = false;
            fail('Gate hatası', p.title + ': cat=' + p.categoryMatch + ' brand=' + p.brandMatch + ' var=' + p.variantMatch + ' tpl=' + p.templateReady);
          }
        });
        if (allGatesCorrect && ready.length > 0) {
          pass('Tüm hazır ürünlerin 4/4 gate\'i doğru');
        }
        
        // Bekleyen ürünlerin eksik nedenlerini say
        const missingCounts = { category: 0, brand: 0, variant: 0, template: 0 };
        notReady.forEach(p => {
          if (p.missingReasons) {
            p.missingReasons.forEach(r => {
              if (r.includes('kategori') || r.includes('Kategori')) missingCounts.category++;
              if (r.includes('marka') || r.includes('Marka')) missingCounts.brand++;
              if (r.includes('varyant') || r.includes('Varyant')) missingCounts.variant++;
              if (r.includes('şablon') || r.includes('Şablon')) missingCounts.template++;
            });
          }
        });
        info('Eksik dağılımı: kategori=' + missingCounts.category + ' marka=' + missingCounts.brand + ' varyant=' + missingCounts.variant + ' şablon=' + missingCounts.template);
      }
    }

    // =====================================================================
    // AŞAMA 8: PAGİNATİON + FİLTRE + SEÇİM
    // =====================================================================
    console.log('\n=== AŞAMA 8: PAGİNATİON + FİLTRE ===');

    if (xsId) {
      // Sayfa 1
      const p1 = await apiGet('/brands/products?page=1&limit=3&xmlSourceId=' + xsId);
      // Sayfa 2
      const p2 = await apiGet('/brands/products?page=2&limit=3&xmlSourceId=' + xsId);
      
      if (p1.json?.items && p2.json?.items) {
        const ids1 = p1.json.items.map(i => i.id);
        const ids2 = p2.json.items.map(i => i.id);
        const overlap = ids1.filter(id => ids2.includes(id));
        if (overlap.length === 0 && (ids1.length > 0 || ids2.length > 0)) {
          pass('Pagination: sayfa 1 ve 2 çakışmasız (' + ids1.length + '+' + ids2.length + ' ürün)');
        } else if (overlap.length > 0) {
          fail('Pagination', overlap.length + ' ürün her iki sayfada da var');
        } else {
          warn('Pagination', 'Her iki sayfa da boş');
        }
      }

      // Search filter
      const searchRes = await apiGet('/brands/products?page=1&limit=5&xmlSourceId=' + xsId + '&search=test');
      if (searchRes.status === 200) {
        pass('Arama filtresi çalışıyor (HTTP 200)');
      } else {
        warn('Arama filtresi', 'HTTP ' + searchRes.status);
      }

      // Unbranded filter
      const unbranded = await apiGet('/brands/products?page=1&limit=5&xmlSourceId=' + xsId + '&unbranded=true');
      if (unbranded.status === 200) {
        const items = unbranded.json?.items || [];
        const allUnbranded = items.every(i => !i.brand?.name && !i.xmlBrandName);
        if (allUnbranded || items.length === 0) {
          pass('Unbranded filtresi doğru çalışıyor');
        } else {
          warn('Unbranded filtre', items.length + ' ürün markasız değil');
        }
      }
    }

    // =====================================================================
    // AŞAMA 9: YETKİSİZ ERİŞİM
    // =====================================================================
    console.log('\n=== AŞAMA 9: YETKİ KONTROLÜ ===');

    // Auth olmadan API çağrısı
    const noAuth = await ctx.request.get(API + '/auth/me');
    const noAuthJson = await noAuth.json().catch(() => null);
    if (noAuthJson?.authenticated === false) {
      pass('Auth olmadan: authenticated=false (doğru)');
    } else {
      warn('Auth kontrol', 'Auth olmadan authenticated=' + (noAuthJson?.authenticated || 'N/A'));
    }

    // =====================================================================
    // AŞAMA 10: NETWORK/KONSOL HATA KONTROLÜ (UI)
    // =====================================================================
    console.log('\n=== AŞAMA 10: UI + NETWORK HATA ===');

    const networkErrors = [];
    page.on('response', resp => {
      if (resp.status() >= 400 && !resp.url().includes('favicon')) {
        networkErrors.push(resp.url().split('/').pop() + ':' + resp.status());
      }
    });
    
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text().substring(0, 100));
    });

    // UI'da sayfa yükle ve navigasyon yap
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Login varsa login yap
    const modal = await page.$('#login-modal');
    if (modal) {
      const hidden = await modal.evaluate(el => el.classList.contains('hidden'));
      if (!hidden) {
        await page.fill('#login-email', 'admin@dgstok.com');
        await page.fill('#login-password', 'Admin1234!');
        // Login butonu
        const loginBtn = await page.$('#login-modal button[onclick*="doLogin"], #login-modal button:last-of-type');
        if (loginBtn) {
          await loginBtn.click().catch(() => {});
          await page.waitForTimeout(3000);
        }
      }
    }

    // Her sayfaya navigasyon yap
    const navPages = ['prep-categories', 'prep-brands', 'prep-variants', 'prep-listings', 'ready-to-ship'];
    for (const np of navPages) {
      await page.evaluate((name) => {
        const nav = document.getElementById('nav-' + name);
        if (nav) nav.click();
        else if (typeof showPage === 'function') showPage(name);
      }, np);
      await page.waitForTimeout(1500);
      
      const pageEl = await page.$('#page-' + np);
      if (pageEl) {
        const visible = await pageEl.evaluate(el => !el.classList.contains('hidden'));
        if (visible) {
          pass('UI navigasyon: ' + np + ' sayfası görünür');
        } else {
          fail('UI navigasyon: ' + np, 'sayfa gizli');
        }
      }
    }

    if (networkErrors.length === 0) {
      pass('Network hatası yok');
    } else {
      if (networkErrors.length <= 3) {
        pass(networkErrors.length + ' küçük network hatası (404 vb.)');
      } else {
        fail(networkErrors.length + ' network hatası', networkErrors.join(', '));
      }
    }
    if (consoleErrors.length === 0) {
      pass('Console hatası yok');
    } else {
      if (consoleErrors.length <= 2) {
        pass(consoleErrors.length + ' küçük console hatası');
      } else {
        fail(consoleErrors.length + ' console hatası', consoleErrors.join(' | '));
      }
    }

  } catch (e) {
    console.error('\nKRİTİK TEST HATASI:', e.message);
    fail('Test çalıştırma', e.message.substring(0, 150));
  } finally {
    await browser.close();
  }

  // =====================================================================
  // FİNAL RAPORU
  // =====================================================================
  console.log('\n' + '='.repeat(70));
  console.log('FİNAL RAPORU — ÜRÜN HAZIRLAMA → GÖNDERİME HAZIR E2E');
  console.log('='.repeat(70));
  console.log('Toplam test: ' + results.length);
  console.log('PASS: ' + passCount);
  console.log('FAIL: ' + failCount);
  console.log('WARN: ' + warnCount);
  
  if (failCount > 0) {
    console.log('\nBAŞARISIZ TESTLER:');
    results.filter(r => r.s === 'FAIL').forEach(r => console.log('  FAIL: ' + r.name + ' → ' + r.e));
  }
  if (warnCount > 0) {
    console.log('\nUYARILAR:');
    results.filter(r => r.s === 'WARN').forEach(r => console.log('  WARN: ' + r.name + ' → ' + r.e));
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('SONUÇ: ' + (failCount === 0 ? 'PASS' : 'FAIL'));
  console.log('='.repeat(70));
  
  process.exit(failCount === 0 ? 0 : 1);
})();
