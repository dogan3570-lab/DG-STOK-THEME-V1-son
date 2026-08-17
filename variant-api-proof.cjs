const jwt = require('./server/node_modules/jsonwebtoken');
const fs = require('fs');
function readEnv(key) {
  const txt = fs.readFileSync('./server/.env', 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '');
  }
  return '';
}
(async () => {
  const token = jwt.sign({ role: 'ADMIN', sub: 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d' }, readEnv('JWT_SECRET'), { expiresIn: '1h' });
  const r = await fetch('http://localhost:4001/variants/products?page=1&limit=1000&xmlSourceId=949855eb-d68c-4920-b378-c622a6a665e2', { headers: { Cookie: 'token=' + token } });
  const j = await r.json();
  const cand = (j.items || []).find(p => p.id === '739d360d-8998-436f-bd22-ef7e3539836d');
  console.log('API STATUS for candidate:', cand ? JSON.stringify({ status: cand.status, variantMatch: cand.variantMatch, matchedBy: cand.matchedBy, reason: cand.reason }) : 'not in first 1000');
  const statusCounts = {};
  for (const it of (j.items || [])) statusCounts[it.status] = (statusCounts[it.status] || 0) + 1;
  console.log('STATUS DISTRIBUTION (ilk 1000):', JSON.stringify(statusCounts));
  console.log('PAGINATION total:', j.pagination && j.pagination.total);
})().catch(e => { console.error(e); process.exit(1); });
