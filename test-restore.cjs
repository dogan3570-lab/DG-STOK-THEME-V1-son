const path = require("path");
const h = require(path.join(__dirname, "test-opera-helper.cjs"));
const { launchOperaTestBrowser, setupAuth, createChecker, OPERA_PATH, TEST_PROFILE, BASE_URL } = h;

(async () => {
  const { check, getResults } = createChecker();
  
  console.log("=== OPERA TEST — ProductPreparation Restore ===\n");
  console.log("Browser:", OPERA_PATH);
  console.log("Profile:", TEST_PROFILE);
  console.log("URL:", BASE_URL);

  const context = await launchOperaTestBrowser();
  const { page } = await setupAuth(context);

  const errors = [];
  page.on("console", function(msg) { if (msg.type() === "error") errors.push(msg.text().substring(0, 200)); });

  console.log("\n1. Auth OK — Opera test profile");

  await page.evaluate(function() {
    window.dispatchEvent(new CustomEvent("dgstok:navigate", { detail: "urunhazirlama" }));
  });
  await page.waitForTimeout(5000);
  console.log("2. Navigated to ProductPreparation");

  await page.screenshot({ path: "C:\\Users\\Dogan\\AppData\\Local\\Temp\\opencode\\ss-opera-01.png", fullPage: true });

  console.log("\n--- TABS ---");
  const allButtons = await page.locator("button").allTextContents();
  var tabNames = ["Kategori", "Marka", "Varyant", "Listeleme"];
  for (var i = 0; i < tabNames.length; i++) {
    var found = allButtons.some(function(t) { return t.includes(tabNames[i]); });
    check("Tab: " + tabNames[i], found);
  }
  
  var hasZorunlu = allButtons.some(function(t) { return t.includes("Zorunlu"); });
  check("No Zorunlu Alanlar tab", !hasZorunlu);

  var hasPanel = await page.locator("text=Pazaryeri Zorunlu Alanlar").isVisible({ timeout: 2000 }).catch(function() { return false; });
  check("No MissingFieldsPanel visible", !hasPanel);

  var tabContainer = page.locator(".rounded-2xl.border.bg-transparent.p-1");

  console.log("\n--- KATEGORI TAB ---");
  var kategoriBtn = tabContainer.locator("button").filter({ hasText: "Kategori" }).first();
  if (await kategoriBtn.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
    await kategoriBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "C:\\Users\\Dogan\\AppData\\Local\\Temp\\opencode\\ss-opera-kategori.png", fullPage: true });
    var content = await page.locator("body").textContent();
    check("Kategori tab content", content.includes("Kategori") || content.includes("XML") || content.includes("Trendyol"));
  } else { check("Kategori tab visible", false); }

  console.log("\n--- MARKA TAB ---");
  var markaBtn = tabContainer.locator("button").filter({ hasText: "Marka" }).first();
  if (await markaBtn.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
    await markaBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "C:\\Users\\Dogan\\AppData\\Local\\Temp\\opencode\\ss-opera-marka.png", fullPage: true });
    var content = await page.locator("body").textContent();
    check("Marka tab content", content.includes("Marka") || content.includes("Brand") || content.includes("marka"));
  } else { check("Marka tab visible", false); }

  console.log("\n--- VARYANT TAB ---");
  var varyantBtn = tabContainer.locator("button").filter({ hasText: "Varyant" }).first();
  if (await varyantBtn.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
    await varyantBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "C:\\Users\\Dogan\\AppData\\Local\\Temp\\opencode\\ss-opera-varyant.png", fullPage: true });
    var content = await page.locator("body").textContent();
    check("Varyant tab content", content.includes("Varyant") || content.includes("SKU") || content.includes("varyant"));
  } else { check("Varyant tab visible", false); }

  console.log("\n--- LISTELEME TAB ---");
  var listelemeBtn = tabContainer.locator("button").filter({ hasText: "Listeleme" }).first();
  if (await listelemeBtn.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
    await listelemeBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "C:\\Users\\Dogan\\AppData\\Local\\Temp\\opencode\\ss-opera-listeleme.png", fullPage: true });
    var content = await page.locator("body").textContent();
    check("Listeleme tab content", content.includes("Listeleme") || content.includes("Sablon") || content.includes("Template") || content.includes("Fiyat"));
  } else { check("Listeleme tab visible", false); }

  console.log("\n--- CONSOLE ERRORS ---");
  check("Console errors = 0", errors.length === 0, "count=" + errors.length);
  if (errors.length > 0) { errors.slice(0, 5).forEach(function(e) { console.log("  ERROR: " + e); }); }

  console.log("\n--- BROWSER FINGERPRINT ---");
  var finalUrl = page.url();
  var title = await page.title();
  var browserInfo = await page.evaluate(function() { return navigator.userAgent; });
  check("URL is localhost:4000", finalUrl.includes("localhost:4000"), finalUrl);
  check("Title correct", title.includes("DG STOK"), title);
  check("Browser is Opera", browserInfo.includes("OPR") || browserInfo.includes("Opera"), browserInfo.substring(0, 80));

  await context.close();

  var results = getResults();
  console.log("\n========================================");
  console.log("Browser:      Opera (test profile)");
  console.log("Profile:      " + TEST_PROFILE);
  console.log("URL:          " + BASE_URL);
  console.log("RESULTS:      " + results.PASS + " PASS / " + results.FAIL + " FAIL");
  console.log("========================================");

  process.exit(results.FAIL > 0 ? 1 : 0);
})().catch(function(e) { console.error("FAILED:", e.message); process.exit(1); });
