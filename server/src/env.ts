import { z } from 'zod';

/**
 * FAIL-CLOSED secret doğrulaması.
 * Değer asla hata mesajına/log'a yazılmaz; yalnızca eksik/kısa olduğu bildirilir.
 */
function requireSecret(name: string, minLength: number): string {
  const value = process.env[name];
  if (!value || value.trim().length < minLength) {
    throw new Error(
      `FATAL: ${name} is missing or too short (min ${minLength} chars). ` +
      `Server refuses to start (fail-closed). Set a strong random ${name}.`
    );
  }
  return value.trim();
}

const EnvSchema = z.object({
  PORT: z.coerce.number().optional().default(4000),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  CORS_ORIGIN: z.string().optional(),
  JWT_SECRET: z.string().min(8),
  JWT_EXPIRES_IN: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(32),
});

export const env = EnvSchema.parse({
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  JWT_SECRET: requireSecret('JWT_SECRET', 8),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  CREDENTIAL_ENCRYPTION_KEY: requireSecret('CREDENTIAL_ENCRYPTION_KEY', 32),
});
