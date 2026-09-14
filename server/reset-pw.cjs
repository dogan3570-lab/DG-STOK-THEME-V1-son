const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();

async function main() {
  const email = 'admin@dgstok.com';
  const newPassword = 'Admin1234!'; // admin123 degil, mustChangePassword tetiklenmesin
  const hashed = await bcrypt.hash(newPassword, 10);
  
  await p.user.update({
    where: { email },
    data: { 
      password: hashed,
      preferences: JSON.stringify({ mustChangePassword: false }),
    },
  });
  
  console.log('Updated: ' + email + ' / ' + newPassword);
  
  const user = await p.user.findUnique({ where: { email } });
  const match = await bcrypt.compare(newPassword, user.password);
  const defaultMatch = await bcrypt.compare('admin123', user.password);
  console.log('Verify password match: ' + match);
  console.log('Verify not default (admin123): ' + !defaultMatch);
  
  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
