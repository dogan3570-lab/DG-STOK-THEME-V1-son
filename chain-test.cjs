const http = require('http');
const jwt = require('./server/node_modules/jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const { PrismaClient } = require('./server/node_modules/.prisma/client');

const env = fs.readFileSync('server/.env', 'utf8');
const jwtSecret = env.match(/JWT_SECRET=(.+)/)[1].trim();
const encKey = env.match(/CREDENTIAL_ENCRYPTION_KEY=(.+)/)[1].trim();
const token = jwt.sign({ sub: 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d', role: 'ADMIN' }, jwtSecret);

const TEST_KEY = 'TEST_UI_KEY_1234567890_ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let pass = 0, fail = 0;
function ok(label, condition, detail) { if (condition) { pass++; console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`); } else { fail++; console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); } }

async function main() {
  console.log('=== ADIM 2: DB LOCK KONTROL ===\n');

  // 2a: DB dosyası var mı
  const dbPath = 'server/prisma/dev.db';
  const dbExists = fs.existsSync(dbPath);
  ok('DB dosyası mevcut', dbExists);
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';
  const walExists = fs.existsSync(walPath);
  const shmExists = fs.existsSync(shmPath);
  ok('WAL dosyası mevcut', walExists);
  ok('SHM dosyası mevcut', shmExists);

  if (walExists) {
    const walSize = fs.statSync(walPath).size;
    ok('WAL boyutu', walSize >= 0, `${walSize} bytes`);
  }

  // 2b: Prisma ile okuma testi
  const prisma = new PrismaClient();
  try {
    const row = await prisma.aIProviderConfig.findUnique({ where: { provider: 'openrouter' } });
    ok('Prisma read', !!row);
    if (row) {
      ok('apiKeyEncrypted mevcut', !!row.apiKeyEncrypted, `len=${row.apiKeyEncrypted?.length || 0}`);
      ok('apiKeyIv mevcut', !!row.apiKeyIv, `len=${row.apiKeyIv?.length || 0}`);
      ok('apiKeyTag mevcut', !!row.apiKeyTag, `len=${row.apiKeyTag?.length || 0}`);
      ok('active', row.active === true, `${row.active}`);
      ok('model', !!row.model, row.model);
      console.log(`  📋 updatedAt: ${row.updatedAt.toISOString()}`);
    }
  } catch (e) {
    ok('Prisma read', false, e.message);
  }

  // 2c: Küçük test UPDATE (priority)
  console.log('\n--- DB WRITE TEST ---');
  try {
    const before = await prisma.aIProviderConfig.findUnique({ where: { provider: 'openrouter' }, select: { priority: true } });
    const newPriority = before.priority === 5 ? 6 : 5;
    await prisma.aIProviderConfig.update({ where: { provider: 'openrouter' }, data: { priority: newPriority } });
    const after = await prisma.aIProviderConfig.findUnique({ where: { provider: 'openrouter' }, select: { priority: true } });
    ok('Prisma WRITE + READ', after.priority === newPriority, `priority ${before.priority} → ${after.priority}`);
    // Restore
    await prisma.aIProviderConfig.update({ where: { provider: 'openrouter' }, data: { priority: before.priority } });
    ok('Priority restore', true);
  } catch (e) {
    ok('Prisma WRITE', false, e.message);
  }

  console.log('\n=== ADIM 3: TAM ZİNCİR TEST (UI → PUT → ENCRYPT → DB → GET) ===\n');

  // 3a: PUT test
  function putRequest(body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const opts = {
        hostname: 'localhost', port: 4000,
        path: '/ai-settings/openrouter', method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
          'Content-Length': Buffer.byteLength(data),
        },
      };
      const req = http.request(opts, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, body: d }); }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  // 3a-i: PUT body TEST_KEY ile
  const putBody = { priority: 5, active: true, model: 'google/gemini-2.0-flash-001', apiKey: TEST_KEY };
  console.log(`PUT /ai-settings/openrouter`);
  console.log(`  body.apiKey length: ${TEST_KEY.length}`);
  console.log(`  body.apiKey starts with: ${TEST_KEY.substring(0, 12)}...`);

  const putResult = await putRequest(putBody);
  ok('PUT status 200', putResult.status === 200, `status=${putResult.status}`);
  ok('PUT apiKeyConfigured=true', putResult.body?.apiKeyConfigured === true, `${putResult.body?.apiKeyConfigured}`);

  // 3b: DB'den doğrula — Prisma
  console.log('\n--- DB DOĞRULAMA (Prisma) ---');
  const prismaRow = await prisma.aIProviderConfig.findUnique({ where: { provider: 'openrouter' } });
  ok('DB row bulundu', !!prismaRow);
  ok('DB apiKeyEncrypted updated', !!prismaRow?.apiKeyEncrypted, `len=${prismaRow?.apiKeyEncrypted?.length || 0}`);
  ok('DB apiKeyIv updated', !!prismaRow?.apiKeyIv, `len=${prismaRow?.apiKeyIv?.length || 0}`);
  ok('DB apiKeyTag updated', !!prismaRow?.apiKeyTag, `len=${prismaRow?.apiKeyTag?.length || 0}`);
  console.log(`  📋 updatedAt: ${prismaRow?.updatedAt?.toISOString()}`);

  // 3c: Decrypt test
  console.log('\n--- DECRYPT TEST ---');
  try {
    const derivedKey = crypto.scryptSync(encKey, 'dg-stok-cred-v1', 32);
    const iv = Buffer.from(prismaRow.apiKeyIv, 'hex');
    const tag = Buffer.from(prismaRow.apiKeyTag, 'hex');
    const encBuf = Buffer.from(prismaRow.apiKeyEncrypted, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encBuf), decipher.final()]).toString('utf8');
    ok('Decrypt başarılı', decrypted === TEST_KEY, `len=${decrypted.length}`);
    ok('Decrypt value match', decrypted === TEST_KEY);
  } catch (e) {
    ok('Decrypt', false, e.message);
  }

  // 3d: GET after save
  console.log('\n--- GET AFTER SAVE ---');
  function getRequest(path) {
    return new Promise((resolve, reject) => {
      const opts = {
        hostname: 'localhost', port: 4000,
        path, method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token },
      };
      const req = http.request(opts, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, body: d }); }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  const getSingle = await getRequest('/ai-settings/openrouter');
  ok('GET /:provider apiKeyConfigured', getSingle.body?.apiKeyConfigured === true);

  const getList = await getRequest('/ai-settings');
  const orItem = getList.body?.items?.find(x => x.provider === 'openrouter');
  ok('GET / list apiKeyConfigured', orItem?.apiKeyConfigured === true);

  console.log('\n--- SONUÇ ---');
  console.log(`  ✅ PASS: ${pass}`);
  console.log(`  ❌ FAIL: ${fail}`);
  console.log(`  GENEL: ${fail === 0 ? 'PASS' : 'FAIL'}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
