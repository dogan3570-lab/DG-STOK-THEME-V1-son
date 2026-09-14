const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();

async function main() {
  const users = await p.user.findMany({ select: { id: true, email: true, role: true, preferences: true, password: true } });
  console.log('Users:', JSON.stringify(users.map(u => ({ ...u, password: u.password.substring(0, 20) + '...' })), null, 2));
  
  // Try all password combos
  const passwords = ['admin123', 'Admin123!', 'CHANGE_ME_NOW', 'admin', 'password', '123456'];
  for (const u of users) {
    for (const pw of passwords) {
      const match = await bcrypt.compare(pw, u.password);
      if (match) {
        console.log('FOUND: ' + u.email + ' / ' + pw);
      }
    }
  }
  
  const mpCount = await p.marketplace.count();
  const xsCount = await p.xmlSource.count();
  const prodCount = await p.product.count();
  console.log('Marketplaces:', mpCount);
  console.log('XmlSources:', xsCount);
  console.log('Products:', prodCount);
  
  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
