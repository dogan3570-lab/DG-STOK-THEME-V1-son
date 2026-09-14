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

# Get unmatched products (more to find ones needing AI)
status, products_data = api('GET', '/products?pageSize=20&matchStatus=unmatched', token=token)
items = products_data.get('items', products_data.get('products', []))
print(f'Unmatched products available: {len(items)}')

if not items:
    print('NO UNMATCHED PRODUCTS')
    exit(0)

# Test first 5 products individually to find one that needs AI
tested = 0
for item in items[:10]:
    pid = item.get('id', '?')
    pname = item.get('name', '?')[:40]
    
    # Get DB state before
    conn_db = sqlite3.connect('C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db')
    cur = conn_db.cursor()
    cur.execute("SELECT categoryMatch FROM product WHERE id=?", (pid,))
    before = cur.fetchone()
    conn_db.close()
    
    if before and before[0] == 1:
        continue  # Skip already matched
    
    t0 = time.time()
    status, result = api('POST', '/category-engine/run', {'productIds': [pid]}, token=token)
    elapsed = time.time() - t0
    
    ok = result.get('ok', False)
    print(f'[{tested+1}] {pname[:30]}... HTTP={status} ok={ok} ({elapsed:.1f}s)')
    
    # Check DB after
    conn_db = sqlite3.connect('C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db')
    cur = conn_db.cursor()
    cur.execute("SELECT categoryMatch FROM product WHERE id=?", (pid,))
    after = cur.fetchone()
    conn_db.close()
    
    if after:
        changed = before[0] != after[0] if before else True
        print(f'    DB: before={before[0] if before else "?"} after={after[0]} changed={changed}')
    
    tested += 1
    if tested >= 5:
        break

print(f'Tested {tested} products')
