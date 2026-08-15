import bcrypt from 'bcryptjs';
import { prisma } from './db/prisma.ts';
import { env } from './env.ts';

export async function ensureDefaultAdminUser() {
  const email = String(env.ADMIN_EMAIL ?? 'admin@dgstok.com');
  const password = String(env.ADMIN_PASSWORD ?? 'admin123');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

  const hashed = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: {
      email,
      password: hashed,
      role: 'ADMIN',
    },
  });
}

export async function seedDefaultMarketplaces() {
  // Duplicate temizliği: eski 'trendyol' anahtarını kaldır (yeni standart 'tt')
  try {
    await prisma.marketplace.deleteMany({ where: { key: 'trendyol' } });
  } catch {
    // İlişkili kayıt varsa sessiz geç — migration yapılmadı
  }

  const existingKeys = await prisma.marketplace.findMany({ select: { key: true } });
  const existingKeySet = new Set(existingKeys.map(k => k.key));

  const toSeed = [
    { key: 'tt', name: 'Trendyol' },
    { key: 'he', name: 'Hepsiburada' },
    { key: 'n11', name: 'N11' },
  ].filter(item => !existingKeySet.has(item.key));

  if (toSeed.length === 0) return;

  await prisma.marketplace.createMany({
    data: toSeed.map(item => ({ key: item.key, name: item.name, apiStatus: 'unknown' })),
  });
}

export async function ensureDefaultListingTemplates() {
  const marketplaces = await prisma.marketplace.findMany({ where: { active: true }, select: { id: true } });
  for (const mp of marketplaces) {
    const existing = await prisma.listingTemplate.findFirst({ where: { marketplaceId: mp.id } });
    if (!existing) {
      await prisma.listingTemplate.create({
        data: {
          name: 'Varsayılan Şablon',
          marketplaceId: mp.id,
          titleFormat: '{title}',
          priceSource: 'XML_PURCHASE',
          vatMode: 'INCLUDED',
          priceMultiplier: 1.0,
          priceFixedAmount: 0,
          active: true,
        },
      });
    }
  }
}

export async function seedDefaultAIProviders() {
  const existing = await prisma.aIProviderConfig.count();
  if (existing === 0) {
    await prisma.aIProviderConfig.createMany({
      data: [
        {
          provider: 'nvidia',
          displayName: 'NVIDIA NIM',
          baseUrl: 'https://integrate.api.nvidia.com/v1',
          model: 'nvidia/llama-3.1-nemotron-70b-instruct',
          priority: 1,
          active: false,
          lastStatus: 'unknown',
        },
        {
          provider: 'gemini',
          displayName: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          model: 'gemini-pro',
          priority: 2,
          active: false,
          lastStatus: 'unknown',
        },
        {
          provider: 'deepseek',
          displayName: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          priority: 3,
          active: false,
          lastStatus: 'unknown',
        },
        {
          provider: 'mistral',
          displayName: 'Mistral',
          baseUrl: 'https://api.mistral.ai/v1',
          model: 'mistral-large-latest',
          priority: 4,
          active: false,
          lastStatus: 'unknown',
        },
        {
          provider: 'openai',
          displayName: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4',
          priority: 5,
          active: false,
          lastStatus: 'unknown',
        },
      ],
    });
  }

  // OpenRouter provider kaydı her başlangıçta garantilenir (idempotent, mevcut kayıtları silmez)
  await prisma.aIProviderConfig.upsert({
    where: { provider: 'openrouter' },
    update: {},
    create: {
      provider: 'openrouter',
      displayName: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: null,
      priority: 6,
      active: false,
      lastStatus: 'unknown',
    },
  });
}
