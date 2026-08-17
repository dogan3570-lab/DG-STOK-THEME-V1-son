import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { prisma } from './src/db/prisma.ts';
import { env } from './src/env.ts';

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, preferences: true } });
  const user = users.find((u) => { try { return !JSON.parse(u.preferences || '{}').mustChangePassword; } catch { return true; } }) || users[0];
  if (!user) { process.exit(2); }
  const token = jwt.sign({ role: 'ADMIN', sub: user.id }, env.JWT_SECRET, { expiresIn: '1h' });
  const src = await prisma.xmlSource.findFirst({ select: { id: true } });
  const headers = { Authorization: 'Bearer ' + token };

  const stats = await fetch(`http://localhost:4001/variants/stats?xmlSourceId=${src.id}`, { headers }).then((r) => r.json());
  console.log('STATS:', JSON.stringify(stats));

  const xmlVariants = await fetch(`http://localhost:4001/variants/xml-variants?xmlSourceId=${src.id}`, { headers }).then((r) => r.json());
  console.log('XML-VARIANTS totalProducts/productsWithDetected:', xmlVariants.totalProducts, '/', xmlVariants.productsWithDetectedVariants);
  const items = xmlVariants.items || [];
  const fieldCounts: Record<string, number> = {};
  items.forEach((it: any) => (it.detectedVariants || []).forEach((d: any) => { fieldCounts[d.name] = (fieldCounts[d.name] || 0) + 1; }));
  console.log('XML-VARIANTS field counts:', JSON.stringify(fieldCounts));

  const unmatched = await fetch(`http://localhost:4001/variants/unmatched-products?limit=500&xmlSourceId=${src.id}`, { headers }).then((r) => r.json());
  console.log('UNMATCHED total:', unmatched.total);

  await prisma.$disconnect();
  process.exit(0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => null); process.exit(1); });
