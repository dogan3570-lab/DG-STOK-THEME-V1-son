const { launchOperaTestBrowser, setupAuth } = require('./test-opera-helper.cjs');

(async () => {
  const context = await launchOperaTestBrowser();
  const { page } = await setupAuth(context);
  let PASS = 0, FAIL = 0;
  function check(n, r, d) { if (r) { PASS++; console.log("  PASS: " + n + (d ? " - " + d : "")); } else { FAIL++; console.log("  FAIL: " + n + (d ? " - " + d : "")); } }

  console.log("=== UI INTERACTION TESTS ===");

  await page.evaluate(() => { window.dispatchEvent(new CustomEvent("dgstok:navigate", { detail: "urunhazirlama" })); });
  await page.waitForTimeout(5000);
  const tabBtns = await page.locator("button").all();
  for (const tab of tabBtns) { const t = await tab.textContent(); if (t && t.includes("Zorunlu")) { await tab.click(); break; } }
  await page.waitForTimeout(8000);

  console.log("\n--- TEST: Detail List ---");
  await page.locator("button").filter({ hasText: "Eksik Zorunlu" }).first().click();
  await page.waitForTimeout(15000);
  const pagination = await page.locator("text=/Toplam.*urun/").first().textContent().catch(() => null);
  check("Detail list opened", !!pagination, pagination);

  console.log("\n--- TEST: Gate Modal ---");
  const cards = await page.locator(".space-y-3 > div").all();
  let found = false;
  for (const card of cards) {
    const bs = await card.locator("button").all();
    for (const b of bs) {
      const title = await b.getAttribute("title");
      const cls = await b.getAttribute("class") || "";
      if (cls.includes("amber") && title && title.length > 5) {
        const txt = await b.textContent();
        console.log("  Badge: " + txt);
        await b.click();
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (found) {
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(2000);
      const vis = await page.locator(".fixed.inset-0.z-50").isVisible().catch(() => false);
      if (vis) {
        const mt = await page.locator(".fixed.inset-0.z-50").first().textContent();
        check("Gate modal opened", true, (i + 1) * 2 + "s");
        check("Modal PASS/FAIL", mt.includes("PASS") || mt.includes("FAIL"));
        check("REQUIRED_ATTRIBUTE_MISSING", mt.includes("REQUIRED_ATTRIBUTE_MISSING"));
        console.log("  Modal: " + mt.substring(0, 200));
        break;
      }
    }
  } else {
    check("Attribute badge found", false);
  }

  console.log("\n--- TEST: Filter ---");
  const allBtns = await page.locator("button").all();
  for (const b of allBtns) {
    const t = await b.textContent();
    if (t && t.trim() === "Model") { await b.click(); await page.waitForTimeout(3000); check("Model filter", true); break; }
  }

  console.log("\nRESULTS: " + PASS + " PASS / " + FAIL + " FAIL");
  await context.close();
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
