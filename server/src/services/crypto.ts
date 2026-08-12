import crypto from 'crypto';
import { env } from '../env.ts';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function deriveKey(secret: string): Buffer {
  return crypto.scryptSync(secret, 'dg-stok-ai-salt', KEY_LENGTH);
}

export function encryptApiKey(plaintext: string): { encrypted: string; iv: string; tag: string } {
  const key = deriveKey(env.JWT_SECRET);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return { encrypted, iv: iv.toString('hex'), tag };
}

export function decryptApiKey(encrypted: string, ivHex: string, tagHex: string): string {
  const key = deriveKey(env.JWT_SECRET);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function maskApiKey(plaintext: string): string {
  if (!plaintext || plaintext.length < 8) return '••••••••';
  const prefix = plaintext.substring(0, 4);
  const suffix = plaintext.substring(plaintext.length - 4);
  const masked = '•'.repeat(Math.min(plaintext.length - 8, 16));
  return `${prefix}${masked}${suffix}`;
}
