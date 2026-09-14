import http.client, json, time, sqlite3

def api(method, path, body=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Cookie'] = f'token={token}'
    conn = http.client.HTTPConnection('localhost', 4000)
    payload = json.dumps(body) if body else None
    conn.request(method, path, payload, headers)
    r = conn.getresponse()
    data = r.read().decode()
    return r.status, json.loads(data) if data else {}

# Login
status, login_data = api('POST', '/auth/login', {'email': 'admin@dgstok.com', 'password': 'Stok2026!'})
token = login_data.get('token', '')

# Find products with categoryMatch=0 directly from DB
conn_db = sqlite3.connect('C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db')
cur = conn_db.cursor()
cur.execute("SELECT id, title FROM product WHERE categoryMatch=0 LIMIT 10")
unmatched = cur.fetchall()
conn_db.close()

print(f'DB unmatched products: {len(unmatched)}')
for row in unmatched:
    print(f'  {row[0][:8]}... {row[1][:40] if row[1] else "?"}')

if not unmatched:
    print('NO UNMATCHED PRODUCTS IN DB')
    exit(0)

# Batch test with all unmatched products
pids = [r[0] for r in unmatched]
print(f'\nBatch Category Run: {len(pids)} products')

t0 = time.time()
status, result = api('POST', '/category-engine/run', {'productIds': pids}, token=token)
elapsed = time.time() - t0
print(f'HTTP {status} ({elapsed:.1f}s)')
print(f'ok={result.get("ok")}')
if result.get('error'):
    print(f'error={json.dumps(result["error"])[:300]}')
if result.get('results'):
    print(f'results count={len(result["results"])}')
    for r in result.get('results', [])[:3]:
        print(f'  {r.get("productName","?")[:30]}: matched={r.get("matched")} confidence={r.get("confidence")}')

# Check PM2 logs for AI calls
import subprocess
out = subprocess.run(['pm2', 'logs', 'dg-stok', '--lines', '20', '--nostream'], capture_output=True, text=True, encoding='utf-8', errors='replace')
for line in out.stdout.split('\n'):
    if any(k in line.lower() for k in ['ai_call', 'classify', 'omniroute', 'model', 'run-', 'error']):
        print(f'LOG: {line.strip()[:200]}')

# DB check after
conn_db = sqlite3.connect('C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db')
cur = conn_db.cursor()
cur.execute("SELECT COUNT(*) FROM product WHERE categoryMatch=0")
print(f'\nUnmatched after: {cur.fetchone()[0]}')
cur.execute("SELECT COUNT(*) FROM product WHERE categoryMatch=1")
print(f'Matched after: {cur.fetchone()[0]}')
conn_db.close()
