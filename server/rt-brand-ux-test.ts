import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { prisma } from './src/db/prisma.ts';
import { env } from './src/env.ts';

/**
 * BRAND UX RED TEAM — gerçek HTTP üzerinden /brands/products doğrulaması.
 * Ağ/DB dışı sahte veri üretilmez; canlı sunucuya (:4001) istek atar.
 */
const BASE = process.env.RT_BASE_URL ?? 'http://localhost:4001';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, role: true, preferences: true } });
  let user = users.find((u) => {
    try { return !JSON.parse(u.preferences || '{}').mustChangePassword; } catch { return true; }
  });
  if (!user) user = users[0];
  if (!user) {
    console.log('SKIP: kullanıcı yok');
    await prisma.$disconnect();
    process.exit(2);
  }

  const token = jwt.sign({ role: user.role, sub: user.id }, env.JWT_SECRET, { expiresIn: '1h' });
  const headers = { Authorization: 'Bearer ' + token };

  const src = await prisma.xmlSource.findFirst({ select: { id: true } });
  if (!src) {
    console.log('SKIP: XML kaynağı yok');
    await prisma.$disconnect();
    process.exit(2);
  }
  const brandRow = await prisma.product.findFirst({ where: { xmlSourceId: src.id, xmlBrandName: { not: null } }, select: { xmlBrandName: true } });
  const brand = brandRow?.xmlBrandName || 'Akilli Bayi';

  async function getJson(qs: string) {
    const res = await fetch(`${BASE}/brands/products?${qs}`, { headers });
    return { ok: res.ok, status: res.status, json: await res.json() };
  }

  // BRAND-UX-06: page size 50/100/200/500/1000
  for (const size of [50, 100, 200, 500, 1000]) {
    const { ok, status, json } = await getJson(`page=1&limit=${size}&xmlBrandName=${encodeURIComponent(brand)}&xmlSourceId=${encodeURIComponent(src.id)}`);
    const items = (json && json.items) || [];
    const total = (json && json.pagination && json.pagination.total) || 0;
    check(`BRAND-UX-06: page size ${size} → HTTP ok`, ok, `status=${status}`);
    check(`BRAND-UX-06: page size ${size} → items<=${size}`, items.length <= size, `items=${items.length}`);
    check(`BRAND-UX-06: page size ${size} → total>=0`, Number.isFinite(total) && total >= 0, `total=${total}`);
    if (items.length > 0) {
      const it = items[0];
      const hasFields = !!it.id && 'title' in it && 'originalTitle' in it && 'xmlBrandName' in it && 'brandMatch' in it && 'brandUsageType' in it && 'brand' in it;
      check(`BRAND-UX-02: item alanları tam (id,title,originalTitle,xmlBrandName,brandMatch,brandUsageType,brand)`, hasFields, JSON.stringify(Object.keys(it)));
    }
  }

  // BRAND-UX-07: pagination sayfa 1 vs 2 farklı ID
  const p1 = (await getJson(`page=1&limit=50&xmlBrandName=${encodeURIComponent(brand)}&xmlSourceId=${encodeURIComponent(src.id)}`)).json;
  const p2 = (await getJson(`page=2&limit=50&xmlBrandName=${encodeURIComponent(brand)}&xmlSourceId=${encodeURIComponent(src.id)}`)).json;
  const ids1 = new Set(((p1 && p1.items) || []).map((i: any) => i.id));
  const ids2 = ((p2 && p2.items) || []).map((i: any) => i.id);
  const overlap = ids2.filter((id: string) => ids1.has(id)).length;
  check('BRAND-UX-07: sayfa 1 vs sayfa 2 ID çakışması yok', overlap === 0, `overlap=${overlap}`);
  const totalPages = (p1 && p1.pagination && p1.pagination.totalPages) || 0;
  check('BRAND-UX-07: totalPages hesaplanıyor', totalPages >= 1, `totalPages=${totalPages}`);

  // BRAND-UX-11: context isolation — yanlış xmlSourceId → 0 ürün
  const wrong = (await getJson(`page=1&limit=50&xmlBrandName=${encodeURIComponent(brand)}&xmlSourceId=00000000-0000-0000-0000-000000000000`)).json;
  const wrongItems = (wrong && wrong.items) || [];
  check('BRAND-UX-11: yanlış xmlSourceId → 0 ürün', wrongItems.length === 0, `items=${wrongItems.length} total=${wrong && wrong.pagination && wrong.pagination.total}`);

  // BRAND-UX-08: checkbox kaynağı — her item benzersiz id (aynı sayfada duplicate yok)
  const allIds = ((p1 && p1.items) || []).map((i: any) => i.id);
  check('BRAND-UX-08: aynı sayfada benzersiz ürün id', new Set(allIds).size === allIds.length, `unique=${new Set(allIds).size}/${allIds.length}`);

  console.log('========================================');
  console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
  if (failures.length) { for (const f of failures) console.log(' - ' + f); }
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('TEST CRASH:', e instanceof Error ? e.message : String(e));
  await prisma.$disconnect().catch(() => null);
  process.exit(2);
});
