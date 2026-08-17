import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { execSync } from 'child_process';
import bcrypt from 'bcryptjs';

import {
  ENCRYPTED_CREDENTIAL_PREFIX,
  decryptCredential,
  encryptCredential,
  isEncryptedCredential,
} from './src/services/crypto.ts';
import { env } from './src/env.ts';
import { prisma } from './src/db/prisma.ts';
import { migrateMarketplaceCredentials } from './src/bootstrap.ts';
import { classifyHttpStatus } from './src/services/marketplace/errors.ts';
import { assertSafeApiUrl } from './src/services/marketplace/ssrfGuard.ts';
import { requestWithBoundedRetry } from './src/services/marketplace/httpClient.ts';
import { trendyolAdapter } from './src/services/marketplace/adapters.ts';

const SYNTHETIC_RT = 'RT_SYNTHETIC_REFRESH_TOKEN_ONLY_FOR_TEST';
const SYNTHETIC_KEY_PREFIX = 'rt-synthetic-';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function runProbe(extraEnv: Record<string, string>): { ok: boolean; output: string } {
  const childEnv = { ...process.env, ...extraEnv };
  try {
    const out = execSync('npx tsx rt-p0-env-probe.ts', { env: childEnv, stdio: 'pipe', cwd: process.cwd() }).toString();
    return { ok: out.includes('ENV_OK'), output: out };
  } catch (e: any) {
    const output = String(e?.stdout ?? '') + String(e?.stderr ?? '') + String(e?.message ?? '');
    return { ok: false, output };
  }
}

function signToken(role: string, sub: string): string {
  return jwt.sign({ role, sub }, env.JWT_SECRET, { expiresIn: '1h' } as jwt.SignOptions);
}

async function apiCall(path: string, method: string, body: unknown, token: string | null): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['x-auth-token'] = token;
  const res = await fetch(`http://localhost:4000${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

function jsonStr(obj: unknown): string {
  return JSON.stringify(obj);
}

function containsSecretLeak(value: unknown, secret: string): boolean {
  return typeof value === 'string' && value.includes(secret);
}

function deepScanSecretLeak(obj: unknown, secret: string): boolean {
  if (obj === null || obj === undefined) return false;
  if (typeof obj === 'string') return obj.includes(secret);
  if (Array.isArray(obj)) return obj.some((v) => deepScanSecretLeak(v, secret));
  if (typeof obj === 'object') return Object.values(obj as Record<string, unknown>).some((v) => deepScanSecretLeak(v, secret));
  return false;
}

async function main() {
  console.log('========== RT-P0 CRYPTO / ENV ==========');

  // RT-P0-12/17: roundtrip + bağımsız key + plaintext fallback yok
  const enc = encryptCredential(SYNTHETIC_RT);
  check('RT-P0-12 encrypt enc:v1 format', enc.startsWith(ENCRYPTED_CREDENTIAL_PREFIX), enc.slice(0, 12) + '...');
  check('RT-P0-12 decrypt roundtrip', decryptCredential(enc) === SYNTHETIC_RT);
  check('RT-P0-17 plaintext fallback yok (plaintext -> null)', decryptCredential('plaintext-value') === null);
  check('RT-P0-17 plaintext fallback yok (empty -> null)', decryptCredential('') === null);
  check('RT-P0-16 malformed (kısa) -> null', decryptCredential('enc:v1:abc') === null);
  check('RT-P0-16 malformed (eksik parça) -> null', decryptCredential('enc:v1:abc:def') === null);
  check('RT-P0-16 malformed (hex olmayan) -> null', decryptCredential('enc:v1:zz:yy:xx') === null);

  // RT-P0-15: tampered ciphertext
  const tampered = enc.slice(0, enc.length - 4) + (enc.slice(-4) === 'aaaa' ? 'bbbb' : 'aaaa');
  check('RT-P0-15 tampered ciphertext reddedildi', decryptCredential(tampered) === null);

  // RT-P0-13: fail-closed (CEK yokken)
  const probeCek = runProbe({ CREDENTIAL_ENCRYPTION_KEY: '' });
  check('RT-P0-13 CEK yokken fail-closed', !probeCek.ok && probeCek.output.includes('CREDENTIAL_ENCRYPTION_KEY'), probeCek.output.slice(0, 200));

  // JWT_SECRET de fail-closed
  const probeJwt = runProbe({ JWT_SECRET: '' });
  check('JWT_SECRET yokken fail-closed', !probeJwt.ok && probeJwt.output.includes('JWT_SECRET'), probeJwt.output.slice(0, 200));

  // RT-P0-14: credential encryption key JWT_SECRET'ten bağımsız (JWT_SECRET değişse bile decrypt OK)
  try {
    const encOut = execSync('npx tsx rt-p0-env-probe.ts --indep-enc', {
      env: { ...process.env, JWT_SECRET: 'rt-jwt-secret-A' },
      stdio: 'pipe',
      cwd: process.cwd(),
    }).toString().trim();
    const decOut = execSync(`npx tsx rt-p0-env-probe.ts --indep-dec ${encOut}`, {
      env: { ...process.env, JWT_SECRET: 'rt-jwt-secret-B-DIFFERENT' },
      stdio: 'pipe',
      cwd: process.cwd(),
    }).toString().trim();
    check('RT-P0-14 JWT_SECRET değişse bile credential decrypt OK', decOut.includes('INDEP_OK'), decOut);
  } catch (e: any) {
    check('RT-P0-14 JWT_SECRET değişse bile credential decrypt OK', false, String(e?.message ?? e));
  }

  console.log('========== RT-P0 ERROR / SSRF / RETRY ==========');

  check('classify 400 permanent no-retry', classifyHttpStatus(400, null).permanent === true && classifyHttpStatus(400, null).retryable === false);
  check('classify 422 permanent no-retry', classifyHttpStatus(422, null).permanent === true && classifyHttpStatus(422, null).retryable === false);
  check('classify 401 permanent no-retry', classifyHttpStatus(401, null).permanent === true && classifyHttpStatus(401, null).retryable === false);
  check('classify 403 permanent no-retry', classifyHttpStatus(403, null).permanent === true && classifyHttpStatus(403, null).retryable === false);
  check('classify 404 permanent no-retry', classifyHttpStatus(404, null).permanent === true && classifyHttpStatus(404, null).retryable === false);
  check('classify 409 permanent no-retry', classifyHttpStatus(409, null).permanent === true && classifyHttpStatus(409, null).retryable === false);
  check('classify 429 retryable bounded', classifyHttpStatus(429, 5).retryable === true && classifyHttpStatus(429, 5).cooldownMs === 5000);
  check('classify 500 retryable', classifyHttpStatus(500, null).retryable === true);

  // SSRF engelleme
  const blockedTargets = [
    'http://localhost:8080/x',
    'http://127.0.0.1/x',
    'http://[::1]/x',
    'http://10.0.0.1/x',
    'http://172.16.0.1/x',
    'http://192.168.1.1/x',
    'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/x',
    'ftp://1.2.3.4/x',
  ];
  let ssrfOk = true;
  for (const t of blockedTargets) {
    const r = await assertSafeApiUrl(t);
    if (r.ok) { ssrfOk = false; console.log('   SSRF FAIL (izin verildi): ' + t); }
  }
  check('RT SSRF private/internal engellendi', ssrfOk);
  const publicOk = await assertSafeApiUrl('https://93.184.216.34/x');
  check('RT SSRF public IP izinli', publicOk.ok === true);

  // Retry davranışı (mocked fetch)
  const originalFetch = globalThis.fetch;
  let calls = 0;
  (globalThis as any).fetch = async () => {
    calls++;
    if (calls <= 2) return new Response('err', { status: 500 });
    return new Response(JSON.stringify({ listingId: 'RT_LISTING_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const retryRes = await requestWithBoundedRetry('https://93.184.216.34/probe', { method: 'POST' });
  check('RT 5xx bounded retry (3 deneme)', calls === 3 && retryRes.status === 200, `calls=${calls}`);

  calls = 0;
  (globalThis as any).fetch = async () => {
    calls++;
    return new Response('bad', { status: 400 });
  };
  const noRetryRes = await requestWithBoundedRetry('https://93.184.216.34/probe2', { method: 'POST' });
  check('RT 400 retry edilmiyor (1 deneme)', calls === 1 && noRetryRes.status === 400, `calls=${calls}`);
  globalThis.fetch = originalFetch;

  // Adapter: sahte başarı yok
  const err401 = trendyolAdapter.parseResponse(401, 'raw provider body');
  check('RT adapter 401 -> ok=false + CREDENTIAL_ERROR', err401.ok === false && err401.error?.code === 'CREDENTIAL_ERROR');
  const err500 = trendyolAdapter.parseResponse(500, 'raw provider body');
  check('RT adapter 500 -> ok=false', err500.ok === false);
  const parseNoId = trendyolAdapter.parseResponse(200, JSON.stringify({ foo: 1 }));
  check('RT adapter 2xx ama id yok -> ok=false (sahte başarı yok)', parseNoId.ok === false && parseNoId.error?.code === 'PARSE_ERROR');
  // Trendyol resmi V2: POST yanıtı yalnızca batchRequestId döner. Bu listing ID DEĞİLDİR.
  const parseBatch = trendyolAdapter.parseResponse(200, JSON.stringify({ batchRequestId: 'RT_BATCH_1' }));
  check('RT adapter 2xx + batchRequestId -> ok=true + externalListingId=null (listingId DEĞİL)', parseBatch.ok === true && parseBatch.batchRequestId === 'RT_BATCH_1' && parseBatch.externalListingId === null);
  const parseBarcodeOnly = trendyolAdapter.parseResponse(200, JSON.stringify({ barcode: 'RT_BC_1' }));
  check('RT adapter 2xx + barcode ama batchRequestId yok -> PARSE_ERROR (barcode listingId DEĞİL)', parseBarcodeOnly.ok === false && parseBarcodeOnly.error?.code === 'PARSE_ERROR');

  console.log('========== RT-P0 DB / MIGRATION ==========');

  // RT-P0-01: DB'de plaintext refreshToken olmamalı
  const mps = await prisma.marketplace.findMany({ select: { id: true, key: true, apiKey: true, apiSecret: true, settings: true } });
  let plaintextLeak = false;
  let apiSecretPlain = false;
  for (const m of mps) {
    if (m.apiKey && !isEncryptedCredential(m.apiKey)) plaintextLeak = true;
    if (m.apiSecret && !isEncryptedCredential(m.apiSecret)) apiSecretPlain = true;
    try {
      const s = JSON.parse(m.settings || '{}');
      if (typeof s.refreshToken === 'string' && s.refreshToken.trim()) plaintextLeak = true;
      if (typeof s.apiKey === 'string' || typeof s.apiSecret === 'string') plaintextLeak = true;
    } catch { /* bozuk settings DB taramasında ayrıca raporlanır */ }
  }
  check('RT-P0-01 DB plaintext credential yok', !plaintextLeak && !apiSecretPlain);

  // RT-P0-20: mevcut encrypted apiKey/apiSecret çözülebilir
  let decryptOk = true;
  for (const m of mps) {
    if (m.apiKey && !decryptCredential(m.apiKey)) decryptOk = false;
    if (m.apiSecret && !decryptCredential(m.apiSecret)) decryptOk = false;
  }
  check('RT-P0-20 mevcut encrypted apiKey/apiSecret çözülebilir', decryptOk);

  // RT-P0-02/03: legacy plaintext refreshToken migration + idempotency (sentetik satır)
  const synthKey = `${SYNTHETIC_KEY_PREFIX}${Date.now()}`;
  const synth = await prisma.marketplace.create({
    data: {
      key: synthKey,
      name: 'RT-SYNTHETIC',
      settings: JSON.stringify({ sellerId: 'rt-seller', refreshToken: SYNTHETIC_RT }),
      apiStatus: 'unknown',
      active: true,
    },
  });

  await migrateMarketplaceCredentials();
  const after1 = await prisma.marketplace.findUnique({ where: { id: synth.id }, select: { settings: true } });
  const s1 = JSON.parse(after1?.settings || '{}');
  const migratedEncrypted = typeof s1.refreshTokenEnc === 'string' && isEncryptedCredential(s1.refreshTokenEnc);
  const plaintextGone = !('refreshToken' in s1);
  check('RT-P0-02 legacy plaintext refreshToken -> encrypted', migratedEncrypted && plaintextGone);
  check('RT-P0-02 encrypted refreshToken decrypt edilebilir', migratedEncrypted && decryptCredential(s1.refreshTokenEnc) === SYNTHETIC_RT);

  const snapshot1 = after1?.settings;
  await migrateMarketplaceCredentials();
  const after2 = await prisma.marketplace.findUnique({ where: { id: synth.id }, select: { settings: true } });
  check('RT-P0-03 migration idempotent (ikinci koşuda değişmez)', snapshot1 === after2?.settings);

  // sentetik satırı temizle
  await prisma.productMarketplaceState.deleteMany({ where: { marketplaceId: synth.id } });
  await prisma.marketplace.delete({ where: { id: synth.id } }).catch(() => undefined);

  console.log('========== RT-P0 HTTP (live server) ==========');

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, role: true } });
  if (admin) {
    const adminToken = signToken(admin.role, admin.id);

    // RT-P0-04: GET response refreshToken yok
    const getRes = await apiCall('/marketplace-manage', 'GET', undefined, adminToken);
    let getLeak = false;
    const items = Array.isArray(getRes.json?.items) ? getRes.json.items : [];
    for (const it of items) {
      if (it.apiKey !== undefined) getLeak = true;
      if (it.apiSecret !== undefined) getLeak = true;
      if (it.settings && (it.settings.includes('refreshToken') || it.settings.includes('enc:v1:'))) getLeak = true;
      if (deepScanSecretLeak(it, SYNTHETIC_RT)) getLeak = true;
    }
    check('RT-P0-04 GET response credential/refreshToken yok', getRes.status === 200 && !getLeak);

    // RT-P0-05: POST response refreshToken yok + DB encrypted
    const postBody = {
      key: `${SYNTHETIC_KEY_PREFIX}post-${Date.now()}`,
      name: 'RT-SYNTHETIC-POST',
      apiUrl: 'https://api.example.com/',
      apiKey: 'rt-synth-api-key',
      apiSecret: 'rt-synth-api-secret',
      refreshToken: SYNTHETIC_RT,
    };
    const postRes = await apiCall('/marketplace-manage', 'POST', postBody, adminToken);
    const postItem = postRes.json?.item;
    const postLeak = postRes.status !== 200 || deepScanSecretLeak(postRes.json, SYNTHETIC_RT) || containsSecretLeak(postItem?.settings, SYNTHETIC_RT);
    check('RT-P0-05 POST response refreshToken/secret yok', !postLeak);
    check('RT-P0-05 POST refreshTokenConfigured=true', postItem?.refreshTokenConfigured === true);

    let createdId: string | null = null;
    let createdSettings: string | null = null;
    if (postItem?.id) {
      const createdIdStr = String(postItem.id);
      createdId = createdIdStr;
      const row = await prisma.marketplace.findUnique({ where: { id: createdIdStr }, select: { settings: true } });
      createdSettings = row?.settings ?? null;
      const s = JSON.parse(row?.settings || '{}');
      check('RT-P0-10 yeni refreshToken encrypted kaydedildi', typeof s.refreshTokenEnc === 'string' && isEncryptedCredential(s.refreshTokenEnc) && !('refreshToken' in s));
      check('RT-P0-10 DB plaintext refreshToken yok', !JSON.stringify(row?.settings).includes(SYNTHETIC_RT));
    }

    // RT-P0-09: name-only PUT mevcut encrypted refreshToken'ı korur
    if (createdId) {
      const putNameRes = await apiCall(`/marketplace-manage/${createdId}`, 'PUT', { name: 'RT-SYNTHETIC-POST-RENAMED' }, adminToken);
      const row2 = await prisma.marketplace.findUnique({ where: { id: createdId }, select: { settings: true } });
      check('RT-P0-09 name-only PUT refreshTokenEnc korundu', putNameRes.status === 200 && row2?.settings === createdSettings);

      // RT-P0-06: PUT response refreshToken yok
      const putNewRes = await apiCall(`/marketplace-manage/${createdId}`, 'PUT', { refreshToken: 'RT_SYNTHETIC_NEW_TOKEN_2' }, adminToken);
      const putLeak = deepScanSecretLeak(putNewRes.json, 'RT_SYNTHETIC_NEW_TOKEN_2');
      check('RT-P0-06 PUT response refreshToken/secret yok', putNewRes.status === 200 && !putLeak);
      const row3 = await prisma.marketplace.findUnique({ where: { id: createdId }, select: { settings: true } });
      const s3 = JSON.parse(row3?.settings || '{}');
      check('RT-P0-06 yeni refreshToken encrypted güncellendi', decryptCredential(s3.refreshTokenEnc) === 'RT_SYNTHETIC_NEW_TOKEN_2');
    }

    // RT-P0-18/19: error response / stack trace credential içermiyor
    const badPut = await apiCall('/marketplace-manage/not-a-uuid', 'PUT', { refreshToken: SYNTHETIC_RT }, adminToken);
    check('RT-P0-18 error response credential içermiyor', badPut.status === 400 && !deepScanSecretLeak(badPut.json, SYNTHETIC_RT));

    // RBAC: OPERATOR rolü ile credential manipülasyonu (sentetik OPERATOR kullanıcı)
    const opEmail = `rt-operator-${Date.now()}@rt.local`;
    const op = await prisma.user.create({
      data: { email: opEmail, password: await bcrypt.hash('rt-operator-pass-1', 10), role: 'OPERATOR' },
    });
    const opToken = signToken('OPERATOR', op.id);
    const opPost = await apiCall('/marketplace-manage', 'POST', { key: 'rt-op-' + Date.now(), name: 'x', apiKey: 'rt-op-key' }, opToken);
    check('RT RBAC OPERATOR -> 403', opPost.status === 403, `status=${opPost.status}`);

    // Yetkisiz (token yok) -> 401
    const noAuth = await apiCall('/marketplace-manage', 'GET', undefined, null);
    check('RT RBAC token yok -> 401', noAuth.status === 401, `status=${noAuth.status}`);

    // cleanup: sentetik POST satırı ve OPERATOR kullanıcı
    if (createdId) {
      await prisma.productMarketplaceState.deleteMany({ where: { marketplaceId: createdId } });
      await prisma.marketplace.delete({ where: { id: createdId } }).catch(() => undefined);
    }
    await prisma.user.delete({ where: { id: op.id } }).catch(() => undefined);
  } else {
    check('RT-P0 HTTP (ADMIN kullanıcı bulunamadı — HTTP testleri atlandı)', false, 'no admin user');
  }

  console.log('========================================');
  console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
  if (failures.length) {
    console.log('FAILURES:');
    for (const f of failures) console.log(' - ' + f);
  }

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('TEST CRASH:', e instanceof Error ? e.message : String(e));
  process.exit(2);
});
