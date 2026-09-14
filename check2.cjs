const Database = require('./server/node_modules/better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'server', 'prisma', 'dev.db');

try {
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("SELECT provider, apiKeyEncrypted IS NOT NULL as has_key, apiKeyEncrypted, length(apiKeyEncrypted) as enc_len, active, model, updatedAt FROM AIProviderConfig WHERE provider = 'openrouter'").get();
  console.log('PROVIDER:', row.provider);
  console.log('HAS_KEY:', row.has_key);
  console.log('ENC_LEN:', row.enc_len);
  console.log('ACTIVE:', row.active);
  console.log('MODEL:', row.model);
  console.log('UPDATED_AT:', row.updatedAt);
  console.log('NOW:', new Date().toISOString());
  db.close();
} catch (e) {
  console.log('better-sqlite3 not available, trying sqlite3...');
  console.error(e.message);
}
