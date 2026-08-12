import bcrypt from 'bcryptjs';
import { prisma } from './db/prisma.ts';

export async function ensureDefaultAdminUser() {
  const email = 'admin@dgstok.com';
  const password = 'admin123';

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
  const existing = await prisma.marketplace.count();
  if (existing > 0) return;

  await prisma.marketplace.createMany({
    data: [
      { key: 'tt', name: 'Trendyol', apiStatus: 'unknown' },
      { key: 'he', name: 'Hepsiburada', apiStatus: 'unknown' },
      { key: 'n11', name: 'N11', apiStatus: 'unknown' },
    ],
  });
}

export async function seedDefaultAIProviders() {
  const existing = await prisma.aIProviderConfig.count();
  if (existing > 0) return;

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
