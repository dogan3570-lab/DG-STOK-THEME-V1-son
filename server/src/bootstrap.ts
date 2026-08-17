import bcrypt from 'bcryptjs';
import { prisma } from './db/prisma.ts';
import { env } from './env.ts';
import {
  encryptCredential,
  isEncryptedCredential,
  reencryptCredentialIfLegacy,
  reencryptApiKeyIfLegacy,
} from './services/crypto.ts';

export async function ensureDefaultAdminUser() {
  const email = String(env.ADMIN_EMAIL ?? 'admin@dgstok.com');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

  // FAIL-CLOSED: bilinen default parola ('admin123') artık ÜRETİLMEZ.
  const password = env.ADMIN_PASSWORD ? String(env.ADMIN_PASSWORD) : '';
  if (!password || password.length < 8) {
    console.error(
      '[server] FATAL: ADMIN_PASSWORD is not set. Initial admin user cannot be provisioned safely. ' +
      'Set ADMIN_PASSWORD and restart (fail-closed, no default credential).'
    );
    return null;
  }

  const hashed = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: {
      email,
      password: hashed,
      role: 'ADMIN',
      preferences: JSON.stringify({ mustChangePassword: password === 'admin123' }),
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

/**
 * F-01 / F-CRIT-01: Eski plaintext marketplace credential'larını ve settings içindeki
 * plaintext refreshToken'ı AES-256-GCM encrypted formata dönüştürür.
 * Ayrıca legacy JWT_SECRET-türevli key ile şifrelenmiş credential'ları yeni bağımsız
 * CREDENTIAL_ENCRYPTION_KEY'e taşır. Idempotent; değer ASLA loglanmaz.
 */
export async function migrateMarketplaceCredentials() {
  const mps = await prisma.marketplace.findMany({
    select: { id: true, apiKey: true, apiSecret: true, settings: true },
  });
  let migrated = 0;
  for (const m of mps) {
    const data: { apiKey?: string; apiSecret?: string; settings?: string } = {};

    if (m.apiKey) {
      if (!isEncryptedCredential(m.apiKey)) {
        data.apiKey = encryptCredential(m.apiKey);
      } else {
        const r = reencryptCredentialIfLegacy(m.apiKey);
        if (r.changed) data.apiKey = r.value;
      }
    }
    if (m.apiSecret) {
      if (!isEncryptedCredential(m.apiSecret)) {
        data.apiSecret = encryptCredential(m.apiSecret);
      } else {
        const r = reencryptCredentialIfLegacy(m.apiSecret);
        if (r.changed) data.apiSecret = r.value;
      }
    }

    // settings içindeki refreshToken (legacy plaintext) + refreshTokenEnc (key migration)
    if (m.settings) {
      let parsed: Record<string, unknown> = {};
      try {
        const p = JSON.parse(m.settings);
        if (p && typeof p === 'object' && !Array.isArray(p)) parsed = p;
      } catch {
        /* bozuk settings dokunulmadan bırakılır */
      }
      let settingsChanged = false;

      if (typeof parsed.refreshToken === 'string' && parsed.refreshToken.trim()) {
        parsed.refreshTokenEnc = encryptCredential(parsed.refreshToken.trim());
        delete parsed.refreshToken;
        settingsChanged = true;
      }

      if (typeof parsed.refreshTokenEnc === 'string' && parsed.refreshTokenEnc) {
        if (!isEncryptedCredential(parsed.refreshTokenEnc)) {
          parsed.refreshTokenEnc = encryptCredential(parsed.refreshTokenEnc);
          settingsChanged = true;
        } else {
          const r = reencryptCredentialIfLegacy(parsed.refreshTokenEnc);
          if (r.changed) {
            parsed.refreshTokenEnc = r.value;
            settingsChanged = true;
          }
        }
      }

      if (settingsChanged) data.settings = JSON.stringify(parsed);
    }

    if (Object.keys(data).length > 0) {
      await prisma.marketplace.update({ where: { id: m.id }, data });
      migrated++;
    }
  }
  if (migrated > 0) console.log(`[server] migrated ${migrated} marketplace credential(s) to encrypted format`);
}

/** AI provider key'lerini legacy JWT_SECRET-türevli key'den bağımsız key'e taşır (idempotent). */
export async function migrateAiProviderKeys() {
  const providers = await prisma.aIProviderConfig.findMany({
    select: { id: true, apiKeyEncrypted: true, apiKeyIv: true, apiKeyTag: true },
  });
  let migrated = 0;
  for (const p of providers) {
    if (!p.apiKeyEncrypted || !p.apiKeyIv || !p.apiKeyTag) continue;
    const r = reencryptApiKeyIfLegacy(p.apiKeyEncrypted, p.apiKeyIv, p.apiKeyTag);
    if (r.changed) {
      await prisma.aIProviderConfig.update({
        where: { id: p.id },
        data: { apiKeyEncrypted: r.encrypted, apiKeyIv: r.iv, apiKeyTag: r.tag },
      });
      migrated++;
    }
  }
  if (migrated > 0) console.log(`[server] migrated ${migrated} AI provider key(s) to independent encryption key`);
}
