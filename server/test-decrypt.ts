import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const LEGACY_SALT = 'dg-stok-ai-salt';
const CREDENTIAL_SALT = 'dg-stok-cred-v1';

const JWT_SECRET = 'ySsgOO3P4RiZ8jtu0MBcVYcXNlYn7IWRyZpHhDBs';
const CREDENTIAL_ENCRYPTION_KEY = 'biM4hML5lTIoR75tbKxDk2EdHAjRDHHWdnt1vxf1dzUpKCwSUE3ubOX92FLZa';

function scryptKey(secret: string, salt: string): Buffer {
  return crypto.scryptSync(secret, salt, KEY_LENGTH);
}

function currentKey(): Buffer {
  return scryptKey(CREDENTIAL_ENCRYPTION_KEY, CREDENTIAL_SALT);
}

function legacyKey(): Buffer {
  return scryptKey(JWT_SECRET, LEGACY_SALT);
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

// Test data from marketplace
const encrypted = 'e4d5733d0d8e81d06d7e417784cedf5ba9cb20a8';
const iv = '6349de0a5e9ad80a15c19603f197c70b';
const tag = '46d5c1c0a120081eeb31683919a31dcb';

console.log('Trying currentKey...');
try {
  const result = decryptWithKey(encrypted, iv, tag, currentKey());
  console.log('SUCCESS with currentKey:', result);
} catch (e) {
  console.log('FAILED with currentKey:', (e as Error).message);
}

console.log('Trying legacyKey...');
try {
  const result = decryptWithKey(encrypted, iv, tag, legacyKey());
  console.log('SUCCESS with legacyKey:', result);
} catch (e) {
  console.log('FAILED with legacyKey:', (e as Error).message);
}

// Also try cross-combinations
console.log('Trying current secret with legacy salt...');
try {
  const key = crypto.scryptSync(CREDENTIAL_ENCRYPTION_KEY, LEGACY_SALT, KEY_LENGTH);
  const result = decryptWithKey(encrypted, iv, tag, key);
  console.log('SUCCESS:', result);
} catch (e) {
  console.log('FAILED:', (e as Error).message);
}

console.log('Trying legacy secret with current salt...');
try {
  const key = crypto.scryptSync(JWT_SECRET, CREDENTIAL_SALT, KEY_LENGTH);
  const result = decryptWithKey(encrypted, iv, tag, key);
  console.log('SUCCESS:', result);
} catch (e) {
  console.log('FAILED:', (e as Error).message);
}