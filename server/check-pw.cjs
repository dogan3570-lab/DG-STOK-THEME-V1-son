const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();

async function main() {
  const users = await p.user.findMany({ select: { id: true, email: true, role: true, password: true } });
  
  const passwords = [
    'admin123', 'Admin123!', 'Admin123', 'admin', 'password', '123456',
    'CHANGE_ME_NOW', 'changeme', 'changeme_now', 'Admin@123!',
    'Admin123!@', 'admin123!', 'DGSTOK', 'dgstok', 'Dgstok123!',
    'admin@dgstok.com', 'Test1234!', 'test1234', 'operator123',
  ];
  
  for (const u of users) {
    console.log('\nUser: ' + u.email + ' (role: ' + u.role + ')');
    for (const pw of passwords) {
      try {
        const match = await bcrypt.compare(pw, u.password);
        if (match) {
          console.log('  FOUND PASSWORD: ' + pw);
        }
      } catch(e) {
        console.log('  bcrypt error for ' + pw + ': ' + e.message);
      }
    }
  }
  
  await p.$disconnect();
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
