import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
const REMAINING = ['04eaa732-d4a8-452d-b639-50aa9a7b210f','4f9fd098-1f7e-4e8c-9361-d3e4d86aa3a7','b71b0ff2-59ae-4744-a7e5-49eb9e61d46e','58a38a2c-a314-488c-a4ab-334709b8df89','a888911f-f3e2-46cb-bdae-7bd8e59e9f28','fd7bd9bc-5e67-4310-a322-5aa5dc4f5437','3e157316-8abf-479e-afe1-3f991bd075b2','42c12366-493d-4502-8652-dd375f106224','31e2118f-650b-4dc7-9071-1d125a2a1e29','df3a553f-16c5-44d5-8301-aa277274fca0','f90b51ae-850a-428c-b9a3-57329f5dd6ed','ada0a4cb-d9be-493e-8ee8-7b0832929f40','9233bb5f-b0ba-4b7a-a014-cf4c899913d7','0d5c993a-c483-4a88-bdce-7f5b16cd77fa','a081b629-4a27-4471-935a-c98a17d29ca6','6e8439c3-5fea-4b34-83b4-94ea1ddb7c9c','6116041c-3692-4dd1-8939-4d49a281b574','803067a3-c191-40b6-8312-070b27f27c71','9f80f4e5-ce6f-43a9-9904-d75fd15eaafa','cbe538cb-5cce-4c84-a718-825cb667e759'];
async function main() {
  const tpa = await prisma.trendyolProductAttribute.findMany({ where: { marketplaceKey: 'tt', productId: { in: REMAINING } }, select: { productId: true, attributeId: true, attributeName: true } });
  const byPid = new Map<string, string[]>();
  for (const t of tpa) { if (!byPid.has(t.productId)) byPid.set(t.productId, []); byPid.get(t.productId)!.push(`${t.attributeName}(${t.attributeId})`); }
  for (const pid of REMAINING) {
    const attrs = byPid.get(pid);
    console.log(`${pid.substring(0,8)}: ${attrs ? `TPA=${attrs.length} [${attrs.join(',')}]` : 'NO_TPA'}`);
  }
  console.log(`\nTotal with TPA: ${byPid.size}/${REMAINING.length}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
