// scripts/rt-check-ai-config.ts
// READ-ONLY: Is any AI provider active/configured?
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  const provs = await prisma.aIProviderConfig.findMany({
    select: { provider: true, displayName: true, active: true, lastStatus: true, model: true, apiKeyEncrypted: true, totalRequests: true, successfulRequests: true, failedRequests: true },
  });
  console.log(`AI providers: ${provs.length}`);
  for (const p of provs) {
    console.log(`  ${p.provider} (${p.displayName}) active=${p.active} status=${p.lastStatus} model=${p.model ?? '—'} keySet=${!!p.apiKeyEncrypted} req=${p.totalRequests}/${p.successfulRequests}ok/${p.failedRequests}fail`);
  }
  console.log('');
  // env-based?
  console.log('ENV AI keys:');
  for (const k of ['OPENAI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','ANTHROPIC_API_KEY','DEEPSEEK_API_KEY','AI_API_KEY']) {
    console.log(`  ${k}: ${process.env[k] ? 'SET' : '—'}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
