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
print(f'Login: {status}')

# Get first unmatched product
status, products_data = api('GET', '/products?pageSize=1&matchStatus=unmatched', token=token)
items = products_data.get('items', products_data.get('products', []))
print(f'Unmatched products: {len(items)}')

if not items:
    print('NO UNMATCHED PRODUCTS - ALL ALREADY MATCHED')
    exit(0)

pid = items[0].get('id', '?')
pname = items[0].get('name', '?')[:60]
print(f'Test product: {pid} - {pname}')

# Category Run
t0 = time.time()
status, result = api('POST', '/category-engine/run', {'productIds': [pid]}, token=token)
elapsed = time.time() - t0
print(f'Category Run: HTTP {status} ({elapsed:.1f}s)')
print(f'ok={result.get("ok")}')

if result.get('error'):
    print(f'ERROR: {json.dumps(result["error"])[:300]}')

# Check DB
conn_db = sqlite3.connect('C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db')
cur = conn_db.cursor()

# Find correct column name
cur.execute("PRAGMA table_info(product)")
cols = [c[1] for c in cur.fetchall()]
match_col = 'categoryMatch' if 'categoryMatch' in cols else None
confidence_col = None
for c in cols:
    if 'confidence' in c.lower() or 'matchConfidence' in c:
        confidence_col = c
        break

print(f'DB columns: match={match_col}, confidence={confidence_col}')

if match_col:
    cur.execute(f"SELECT {match_col}" + (f", {confidence_col}" if confidence_col else "") + " FROM product WHERE id=?", (pid,))
    row = cur.fetchone()
    if row:
        print(f'DB after: {match_col}={row[0]}' + (f' {confidence_col}={row[1]}' if confidence_col and len(row) > 1 else ''))
    else:
        print('Product not found')

# Unmatched count after
cur.execute("SELECT COUNT(*) FROM product WHERE categoryMatch=0")
print(f'Unmatched after: {cur.fetchone()[0]}')
conn_db.close()
