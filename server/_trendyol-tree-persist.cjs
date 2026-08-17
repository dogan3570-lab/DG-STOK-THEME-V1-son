// TRENDYOL KATEGORİ AĞACINI DB'YE KALICI AL — backup + dry-run + --apply.
// Credential değerleri yazdırılmaz. Mevcut schema kullanılır (değişiklik YOK).
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const LEGACY_SALT = 'dg-stok-ai-salt';
const CREDENTIAL_SALT = 'dg-stok-cred-v1';
const PREFIX = 'enc:v1:';
const APPLY = process.argv.includes('--apply');
const MP_TT = '757a071c-98c5-4c96-bb8c-2dceac1568dd';
const SOURCE = 'trendyol_catalog';

function scryptKey(secret, salt) { return crypto.scryptSync(secret, salt, KEY_LENGTH); }
function decryptWithKey(enc, iv, tag, key) { const d = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'), { authTagLength: 16 }); d.setAuthTag(Buffer.from(tag, 'hex')); let o = d.update(enc, 'hex', 'utf8'); o += d.final('utf8'); return o; }
function decryptCredential(v) { if (!v || !v.startsWith(PREFIX)) return null; const b = v.slice(PREFIX.length).split(':'); if (b.length !== 3) return null; try { return decryptWithKey(b[2], b[0], b[1], scryptKey(process.env.CREDENTIAL_ENCRYPTION_KEY, CREDENTIAL_SALT)); } catch { try { return decryptWithKey(b[2], b[0], b[1], scryptKey(process.env.JWT_SECRET, LEGACY_SALT)); } catch { return null; } } }

async function fetchTree() {
  const mp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { apiKey: true, apiSecret: true, settings: true } });
  const apiKey = decryptCredential(mp?.apiKey);
  const apiSecret = decryptCredential(mp?.apiSecret);
  let sellerId = null; try { sellerId = JSON.parse(mp?.settings || '{}').sellerId || null; } catch {}
  if (!apiKey || !apiSecret || !sellerId) return { ok: false, tree: [] };
  const res = await fetch('https://apigw.trendyol.com/integration/product/product-categories', {
    headers: { Authorization: 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64'), 'User-Agent': `${sellerId} - SelfIntegration`, Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, tree: [], status: res.status };
  let json = null; try { json = JSON.parse(text); } catch {}
  const arr = Array.isArray(json) ? json : (json?.categories || json?.content || []);
  return { ok: true, status: res.status, tree: arr };
}

(async () => {
  // FAZ 1: mevcut durum
  const before = {
    category: await prisma.category.count(),
    categoryExtNotNull: await prisma.category.count({ where: { externalId: { not: null } } }),
    categoryParentNotNull: await prisma.category.count({ where: { parentId: { not: null } } }),
    mapping: await prisma.categoryMapping.count(),
    mappingTt: await prisma.categoryMapping.count({ where: { marketplaceId: MP_TT } }),
  };
  console.log('ÖNCE:', JSON.stringify(before));

  // gerçek ağacı çek
  const f = await fetchTree();
  console.log(`API: ok=${f.ok} status=${f.status} rootNode=${f.tree.length}`);
  if (!f.ok) { await prisma.$disconnect(); process.exit(1); }

  // flatten: {id, name, parentId, path}
  const flat = [];
  (function walk(nodes, path) {
    for (const n of nodes) {
      if (!n || typeof n.id !== 'number') continue;
      const p = path ? `${path} > ${n.name}` : String(n.name);
      flat.push({ id: n.id, name: String(n.name), parentId: n.parentId ?? null, path: p, leaf: !Array.isArray(n.subCategories) || n.subCategories.length === 0 });
      if (Array.isArray(n.subCategories)) walk(n.subCategories, p);
    }
  })(f.tree, '');
  console.log(`FLAT: ${flat.length} kategori; leaf=${flat.filter(x => x.leaf).length} root=${flat.filter(x => x.parentId == null).length}`);

  // snapshot/backup
  const snapCategories = await prisma.category.findMany({ select: { id: true, name: true, externalId: true, parentId: true } });
  const snapMappings = await prisma.categoryMapping.findMany({ select: { id: true, categoryId: true, marketplaceId: true, externalId: true, externalName: true, externalPath: true, source: true } });
  const backupFile = `_backup-trendyol-tree-${Date.now()}.json`;
  fs.writeFileSync(backupFile, JSON.stringify({ categories: snapCategories, mappings: snapMappings }, null, 2));
  console.log(`BACKUP yazıldı: ${backupFile} (${snapCategories.length} category, ${snapMappings.length} mapping)`);

  // dry-run hesapla
  let willCreate = 0, willUpdateExt = 0, willUpdateName = 0, existingCount = 0;
  const extIndex = new Map(snapCategories.filter(c => c.externalId).map(c => [c.externalId, c]));
  const nameIndex = new Map(snapCategories.map(c => [c.name, c]));
  for (const item of flat) {
    const extKey = String(item.id);
    const byExt = extIndex.get(extKey);
    if (byExt) { existingCount++; if (byExt.name !== item.name) willUpdateName++; continue; }
    const byName = nameIndex.get(item.name);
    if (byName) { willUpdateExt++; continue; }
    willCreate++;
  }
  console.log(`DRY-RUN: mevcut(externalId eşleşen)=${existingCount} externalId-atama=${willUpdateExt} isim-güncelleme=${willUpdateName} YENİ=${willCreate}`);

  if (!APPLY) {
    console.log('[DRY-RUN] Değişiklik yapılmadı. Uygula: node _trendyol-tree-persist.cjs --apply');
    await prisma.$disconnect();
    return;
  }

  // APPLY — pass 1: upsert Category
  const updatedExtMap = new Map(); // externalId -> category.id
  let created = 0, extAssigned = 0, nameUpdated = 0;
  for (const item of flat) {
    const extKey = String(item.id);
    let cat = await prisma.category.findFirst({ where: { externalId: extKey } });
    if (cat) {
      if (cat.name !== item.name) {
        // isim unique; çakışma varsa güncelleme
        const clash = await prisma.category.findUnique({ where: { name: item.name } });
        if (!clash || clash.id === cat.id) {
          await prisma.category.update({ where: { id: cat.id }, data: { name: item.name } });
          nameUpdated++;
        }
      }
    } else {
      cat = await prisma.category.findUnique({ where: { name: item.name } });
      if (cat) {
        await prisma.category.update({ where: { id: cat.id }, data: { externalId: extKey } });
        extAssigned++;
      } else {
        try {
          cat = await prisma.category.create({ data: { name: item.name, externalId: extKey } });
          created++;
        } catch (e) {
          cat = await prisma.category.findUnique({ where: { name: item.name } });
          if (cat && !cat.externalId) { await prisma.category.update({ where: { id: cat.id }, data: { externalId: extKey } }); extAssigned++; }
        }
      }
    }
    updatedExtMap.set(extKey, cat.id);
  }
  console.log(`APPLY pass1: created=${created} extAssigned=${extAssigned} nameUpdated=${nameUpdated}`);

  // pass 2: parentId çözümle
  let parentUpdated = 0;
  for (const item of flat) {
    if (item.parentId == null) continue;
    const childId = updatedExtMap.get(String(item.id));
    const parentId = updatedExtMap.get(String(item.parentId));
    if (!childId || !parentId) continue;
    const cur = await prisma.category.findUnique({ where: { id: childId }, select: { parentId: true } });
    if (cur.parentId !== parentId) {
      await prisma.category.update({ where: { id: childId }, data: { parentId } });
      parentUpdated++;
    }
  }
  console.log(`APPLY pass2: parentUpdated=${parentUpdated}`);

  // pass 3: CategoryMapping upsert (categoryId + marketplaceId + source unique)
  let mappingCreated = 0, mappingSkipped = 0;
  for (const item of flat) {
    const categoryId = updatedExtMap.get(String(item.id));
    if (!categoryId) continue;
    const existing = await prisma.categoryMapping.findUnique({
      where: { categoryId_marketplaceId_source: { categoryId, marketplaceId: MP_TT, source: SOURCE } },
    });
    if (existing) { mappingSkipped++; continue; }
    await prisma.categoryMapping.create({
      data: { categoryId, marketplaceId: MP_TT, externalId: String(item.id), externalName: item.name, externalPath: item.path, source: SOURCE, confidence: 1.0, active: true },
    });
    mappingCreated++;
  }
  console.log(`APPLY pass3: mappingCreated=${mappingCreated} mappingSkipped=${mappingSkipped}`);

  // VERIFY
  const after = {
    category: await prisma.category.count(),
    categoryExtNotNull: await prisma.category.count({ where: { externalId: { not: null } } }),
    categoryParentNotNull: await prisma.category.count({ where: { parentId: { not: null } } }),
    mapping: await prisma.categoryMapping.count(),
    mappingTt: await prisma.categoryMapping.count({ where: { marketplaceId: MP_TT } }),
  };
  console.log('SONRA:', JSON.stringify(after));

  // bütünlük (externalId not null olan gerçek trendiol kategorileri)
  const real = await prisma.category.findMany({ where: { externalId: { not: null } }, select: { id: true, externalId: true, parentId: true, name: true } });
  const ids = new Set(real.map(c => c.id));
  const extIds = real.map(c => c.externalId);
  const dupExt = extIds.length - new Set(extIds).size;
  const extToId = new Map(real.map(c => [c.externalId, c.id]));
  let orphan = 0, cycle = 0;
  for (const c of real) {
    if (c.parentId && !ids.has(c.parentId)) orphan++;
  }
  const parentMap = new Map(real.map(c => [c.id, c.parentId]));
  for (const c of real) { const seen = new Set(); let cur = c.id; while (cur) { if (seen.has(cur)) { cycle++; break; } seen.add(cur); cur = parentMap.get(cur) ?? null; } }
  const roots = real.filter(c => !c.parentId).length;
  const childIds = new Set(real.filter(c => c.parentId).map(c => c.parentId));
  const leaves = real.filter(c => !childIds.has(c.id)).length;
  console.log(`INTEGRITY: realExt=${real.length} dupExternalId=${dupExt} orphan=${orphan} cycle=${cycle} root=${roots} leaf=${leaves}`);

  await prisma.$disconnect();
})();
