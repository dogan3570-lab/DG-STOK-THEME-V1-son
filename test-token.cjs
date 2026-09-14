const jwt = require('C:\\PROJE 1\\DG-STOK-THEME-V1\\server\\node_modules\\jsonwebtoken');
const { PrismaClient } = require('C:\\PROJE 1\\DG-STOK-THEME-V1\\server\\node_modules\\@prisma\\client');
const fs = require('fs');
const path = require('path');

// Read JWT_SECRET from .env
const envContent = fs.readFileSync(path.join(__dirname, 'server', '.env'), 'utf8');
const jwtSecret = envContent.split('\n').find(l => l.startsWith('JWT_SECRET=')).split('=').slice(1).join('=').trim();

const c = new PrismaClient();
c.user.findFirst({ select: { id: true, email: true, role: true } }).then(u => {
  if (!u) { console.log('NO_USER'); process.exit(1); }
  const token = jwt.sign({ sub: u.id, role: u.role }, jwtSecret, { expiresIn: '1h' });
  console.log(token);
  c.$disconnect();
}).catch(e => {
  console.error(e.message);
  c.$disconnect();
});
