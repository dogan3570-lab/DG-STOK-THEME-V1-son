/**
 * FAZ 1 — AI PROVIDER MINIMUM CONFIG FIX + GERÇEK GATEWAY DOĞRULAMASI.
 * Kök neden: aktif tek provider openrouter.model=BOŞ (NO_MODEL); deepseek gerçek API'de çalışıyor.
 * Minimal fix: deepseek.active=true + priority=1 (config verisi; kod değişmez). openrouter'a dokunulmaz.
 */
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { chatCompletion } from './src/services/aiGateway.ts';

async function snapshot() {
  const rows = await prisma.aIProviderConfig.findMany({
    select: { provider: true, model: true, active: true, priority: true, lastStatus: true, totalRequests: true, successfulRequests: true, failedRequests: true },
    orderBy: { priority: 'asc' },
  });
  return rows;
}

async function main() {
  console.log('BEFORE', JSON.stringify(await snapshot(), null, 2));

  const deepseek = await prisma.aIProviderConfig.findUnique({ where: { provider: 'deepseek' } });
  if (!deepseek) throw new Error('deepseek yok');

  await prisma.aIProviderConfig.update({
    where: { provider: 'deepseek' },
    data: { active: true, priority: 1, lastStatus: 'connected' },
  });

  await prisma.auditLog.create({
    data: {
      action: 'AI_PROVIDER_UPDATE',
      entity: 'ai_provider',
      entityId: deepseek.id,
      details: 'DeepSeek aktifleştirildi (priority=1) — Faz 1 kök neden düzeltmesi',
      meta: JSON.stringify({ provider: 'deepseek', active: true, priority: 1, reason: 'openrouter.model bos (NO_MODEL)' }),
    },
  });

  console.log('AFTER_CONFIG', JSON.stringify(await snapshot(), null, 2));

  // Gerçek gateway doğrulama: JSON yanıt iste + parser zinciri
  const chat = await chatCompletion({
    messages: [
      { role: 'system', content: 'You are a test helper. Return ONLY strict JSON.' },
      { role: 'user', content: 'Return exactly: {"ok":true,"word":"DEEPSEEK_GATEWAY_OK"}' },
    ],
    temperature: 0,
    max_tokens: 64,
    response_format: { type: 'json_object' },
  });

  console.log('CHAT_COMPLETION', JSON.stringify({
    ok: chat.ok,
    provider: chat.provider,
    model: chat.model,
    latencyMs: chat.latencyMs,
    content: chat.content,
    error: chat.error,
    errorCode: chat.errorCode,
  }, null, 2));

  let parsedOk = false;
  if (chat.ok && chat.content) {
    try {
      const p = JSON.parse(chat.content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''));
      parsedOk = p.ok === true;
    } catch { parsedOk = false; }
  }
  console.log('PARSER_OK', parsedOk);

  console.log('AFTER_CHAT', JSON.stringify(await snapshot(), null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
