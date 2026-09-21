// scripts/rt-results-api.mjs
const login = await fetch('http://localhost:4000/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
const { token } = await login.json();
const r = await fetch('http://localhost:4000/api/ready-to-ship/results', { headers: { Authorization: 'Bearer ' + token } });
const j = await r.json();
console.log('HTTP', r.status, 'ok=', j.ok);
console.log('COUNTS:', JSON.stringify(j.counts));
console.log('items:', (j.items || []).length);
for (const i of (j.items || []).slice(0, 5)) console.log(`  ${i.barcode} | ${i.marketplaceName} | send=${i.sendStatus} result=${i.result} reason=${i.reasonLabel} target=${i.targetModule}`);
// specifically the reported product barcode
const t = (j.items || []).find(x => x.barcode === '7256195572668');
console.log('BARCODE 7256195572668 =>', JSON.stringify(t && { result: t.result, sendStatus: t.sendStatus, reasonLabel: t.reasonLabel, reasonDetail: t.reasonDetail, externalRef: t.externalRef }));
