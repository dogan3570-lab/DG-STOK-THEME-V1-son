import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 1. Registry durumu - auto/* modeller
  const row = await prisma.setting.findUnique({ where: { key: 'omniroute_registry' } });
  if (!row?.value) { console.log('No registry'); return; }
  const reg = JSON.parse(row.value);
  const autoModels = reg.models.filter(m => m.id.startsWith('auto/'));
  console.log('=== AUTO/* MODELS ===');
  for (const m of autoModels) {
    console.log(`  ${m.id}: free=${m.free} health=${m.health} total=${m.totalRequests} ok=${m.successfulRequests} fail=${m.failedRequests} quarantine=${m.quarantineReason || 'none'} cooldown=${m.cooldownUntil || 'none'} lastErr=${m.lastError || 'none'}`);
  }

  // 2. Top 10 free models by score
  console.log('\n=== TOP 15 FREE MODELS (by score) ===');
  const freeModels = reg.models.filter(m => m.free);
  // Simulate score
  function score(m) {
    let s = 0;
    if (m.health === 'healthy') s += 100;
    else if (m.health === 'unknown') s += 50;
    else if (m.health === 'degraded') s += 20;
    const id = m.id.toLowerCase();
    if (id.startsWith('auto/')) s += 200;
    const total = m.totalRequests || 1;
    const failRate = m.failedRequests / total;
    s -= failRate * 50;
    s -= Math.min(30, m.totalRequests / 3);
    if (m.contextWindow) s += Math.min(30, m.contextWindow / 10000);
    s += Math.min(20, m.successfulRequests / 10);
    if (m.lastUsedAt) {
      const h = (Date.now() - new Date(m.lastUsedAt).getTime()) / 3600000;
      if (h < 1) s -= 10;
    }
    // Check isUsable
    if (m.health === 'quarantined') return { score: -999, usable: false };
    if (m.cooldownUntil && new Date(m.cooldownUntil) > new Date()) return { score: -998, usable: false };
    return { score: s, usable: true };
  }
  const scored = freeModels.map(m => ({ id: m.id, ...score(m) })).filter(m => m.usable);
  scored.sort((a, b) => b.score - a.score);
  for (const m of scored.slice(0, 15)) {
    const entry = freeModels.find(x => x.id === m.id);
    console.log(`  score=${m.score.toFixed(1)} ${m.id} health=${entry.health} ok=${entry.successfulRequests} fail=${entry.failedRequests}`);
  }

  // 3. DB AI configs
  console.log('\n=== DB AI PROVIDER CONFIGS ===');
  const configs = await prisma.aIProviderConfig.findMany({ select: { provider: true, active: true, lastStatus: true, model: true } });
  for (const c of configs) {
    console.log(`  ${c.provider}: active=${c.active} status=${c.lastStatus} model=${c.model || 'none'}`);
  }
}

main().finally(() => prisma.$disconnect());
