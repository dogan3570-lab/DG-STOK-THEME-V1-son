import crypto from 'crypto';
import { env } from '../env.ts';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Legacy key tuzu: eski sürümde credential'lar JWT_SECRET'ten türetilirdi.
 * Yalnızca ESKİ satırların okunması ve tek seferlik re-encrypt için tutulur.
 * Yeni şifreleme ASLA bu tuzu / JWT_SECRET'i kullanmaz.
 */
const LEGACY_SALT = 'dg-stok-ai-salt';

/** Yeni bağımsız credential encryption key tuzu (CREDENTIAL_ENCRYPTION_KEY). */
const CREDENTIAL_SALT = 'dg-stok-cred-v1';

function scryptKey(secret: string, salt: string): Buffer {
  return crypto.scryptSync(secret, salt, KEY_LENGTH);
}

function currentKey(): Buffer {
  return scryptKey(env.CREDENTIAL_ENCRYPTION_KEY, CREDENTIAL_SALT);
}

function legacyKey(): Buffer {
  return scryptKey(env.JWT_SECRET, LEGACY_SALT);
}

function encryptWithKey(plaintext: string, key: Buffer): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return { encrypted, iv: iv.toString('hex'), tag };
}

function decryptWithKey(encryptedHex: string, ivHex: string, tagHex: string, key: Buffer): string {
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export const ENCRYPTED_CREDENTIAL_PREFIX = 'enc:v1:';

/** AI provider api key alanları için (mevcut imza korunur) — yeni bağımsız key kullanır. */
export function encryptApiKey(plaintext: string): { encrypted: string; iv: string; tag: string } {
  return encryptWithKey(plaintext, currentKey());
}

/** AI provider api key alanları için (mevcut imza korunur) — önce yeni key, sonra legacy. */
export function decryptApiKey(encrypted: string, ivHex: string, tagHex: string): string {
  try {
    return decryptWithKey(encrypted, ivHex, tagHex, currentKey());
  } catch {
    return decryptWithKey(encrypted, ivHex, tagHex, legacyKey());
  }
}

/** Tek string alanda saklanabilir, AES-256-GCM şifreli credential formatı (enc:v1:<iv>:<tag>:<cipher>). */
export function encryptCredential(plaintext: string): string {
  const { encrypted, iv, tag } = encryptWithKey(plaintext, currentKey());
  return `${ENCRYPTED_CREDENTIAL_PREFIX}${iv}:${tag}:${encrypted}`;
}

export function isEncryptedCredential(value: string | null | undefined): boolean {
  return !!value && value.startsWith(ENCRYPTED_CREDENTIAL_PREFIX);
}

interface EncryptedParts { iv: string; tag: string; encrypted: string; }

function parseEncryptedCredential(value: string | null | undefined): EncryptedParts | null {
  if (!value || !isEncryptedCredential(value)) return null;
  const body = value.slice(ENCRYPTED_CREDENTIAL_PREFIX.length);
  const parts = body.split(':');
  if (parts.length !== 3) return null;
  const [iv, tag, encrypted] = parts;
  if (!iv || !tag || !encrypted) return null;
  if (!/^[0-9a-fA-F]+$/.test(iv) || iv.length !== IV_LENGTH * 2) return null;
  if (!/^[0-9a-fA-F]+$/.test(tag) || tag.length !== TAG_LENGTH * 2) return null;
  if (!/^[0-9a-fA-F]+$/.test(encrypted)) return null;
  return { iv, tag, encrypted };
}

/**
 * 'enc:v1:' credential decrypt.
 * - malformed/tampered ciphertext güvenle reddedilir (null döner, secret sızmaz).
 * - plaintext fallback YOKTUR.
 * - önce yeni bağımsız key, başarısızsa yalnızca legacy key (eski satırlar için) denenir.
 */
export function decryptCredential(value: string | null | undefined): string | null {
  const parts = parseEncryptedCredential(value);
  if (!parts) return null;
  try {
    return decryptWithKey(parts.encrypted, parts.iv, parts.tag, currentKey());
  } catch {
    try {
      return decryptWithKey(parts.encrypted, parts.iv, parts.tag, legacyKey());
    } catch {
      return null;
    }
  }
}

/** Eski JWT_SECRET-türevli key ile şifrelenmiş credential'ı yeni bağımsız key'e taşır (idempotent). */
export function reencryptCredentialIfLegacy(value: string | null | undefined): { value: string; changed: boolean } {
  const parts = parseEncryptedCredential(value);
  if (!parts) return { value: value ?? '', changed: false };
  try {
    decryptWithKey(parts.encrypted, parts.iv, parts.tag, currentKey());
    return { value: value as string, changed: false };
  } catch {
    /* legacy key ile dene */
  }
  try {
    const plain = decryptWithKey(parts.encrypted, parts.iv, parts.tag, legacyKey());
    return { value: encryptCredential(plain), changed: true };
  } catch {
    return { value: value as string, changed: false };
  }
}

/** AI provider (ayrık kolon) key'i için legacy → yeni key re-encrypt (idempotent). */
export function reencryptApiKeyIfLegacy(
  encrypted: string,
  ivHex: string,
  tagHex: string
): { encrypted: string; iv: string; tag: string; changed: boolean } {
  try {
    decryptWithKey(encrypted, ivHex, tagHex, currentKey());
    return { encrypted, iv: ivHex, tag: tagHex, changed: false };
  } catch {
    /* legacy key ile dene */
  }
  try {
    const plain = decryptWithKey(encrypted, ivHex, tagHex, legacyKey());
    const out = encryptWithKey(plain, currentKey());
    return { encrypted: out.encrypted, iv: out.iv, tag: out.tag, changed: true };
  } catch {
    return { encrypted, iv: ivHex, tag: tagHex, changed: false };
  }
}

export function maskApiKey(plaintext: string): string {
  if (!plaintext || plaintext.length < 8) return '••••••••';
  const prefix = plaintext.substring(0, 4);
  const suffix = plaintext.substring(plaintext.length - 4);
  const masked = '•'.repeat(Math.min(plaintext.length - 8, 16));
  return `${prefix}${masked}${suffix}`;
}
