// GEÇİCİ TEST KOLAYLAŞTIRICI: mustChangePassword bayrağını false yap (auth KODU değil, test verisi).
// admin123 ile yeniden girişte login handler bayrağı tekrar true yapar; kalıcı değişiklik değildir.
process.env.DATABASE_URL = 'file:C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db';
const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const u = await p.user.findFirst({ where: { email: 'admin@dgstok.com' } });
  let prefs = {};
  try { prefs = JSON.parse(u.preferences || '{}'); } catch { prefs = {}; }
  prefs.mustChangePassword = false;
  await p.user.update({ where: { id: u.id }, data: { preferences: JSON.stringify(prefs) } });
  console.log('OK mustChangePassword=false');
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
