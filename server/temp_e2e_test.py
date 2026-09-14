import http.client, json, time

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
print(f'Login: {status} token={bool(token)}')

if not token:
    print('FAIL: no token')
    exit(1)

# Get first unmatched product
status, products_data = api('GET', '/products?pageSize=1&matchStatus=unmatched', token=token)
items = products_data.get('items', products_data.get('products', []))
print(f'Products: {status} count={len(items)}')

if not items:
    print('NO UNMATCHED PRODUCTS')
    exit(1)

pid = items[0].get('id', '?')
pname = items[0].get('name', '?')[:60]
print(f'Test product: {pid} - {pname}')

# Category Run
t0 = time.time()
status, result = api('POST', '/category-engine/run', {'productIds': [pid]}, token=token)
elapsed = time.time() - t0
print(f'Category Run: HTTP {status} ({elapsed:.1f}s)')
print(f'ok={result.get("ok")} error={result.get("error")} details={json.dumps(result.get("error",{}))[:200]}')

# Check DB write
import sqlite3
conn_db = sqlite3.connect('C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db')
cur = conn_db.cursor()
cur.execute("SELECT categoryMatch, categoryMatchConfidence FROM product WHERE id=?", (pid,))
row = cur.fetchone()
if row:
    print(f'DB after: categoryMatch={row[0]} confidence={row[1]}')
else:
    print('Product not found in DB')
conn_db.close()
