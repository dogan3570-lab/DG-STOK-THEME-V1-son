import http.client, json, time, sqlite3

BASE = 'localhost:4000'
TOKEN = None

def api(method, path, body=None):
    global TOKEN
    conn = http.client.HTTPConnection(BASE, timeout=120)
    headers = {'Content-Type': 'application/json'}
    if TOKEN: headers['Authorization'] = f'Bearer {TOKEN}'
    conn.request(method, path, json.dumps(body) if body else None, headers)
    r = conn.getresponse()
    data = json.loads(r.read())
    conn.close()
    return r.status, data

# Login
s, d = api('POST', '/auth/login', {'email': 'admin@dgstok.com', 'password': 'Stok2026!'})
TOKEN = d.get('token')
print(f'Login: {s}')

# Get 3 unmatched products from DB
db = sqlite3.connect(r'C:\PROJE 1\DG-STOK-THEME-V1\server\prisma\dev.db')
rows = db.execute("SELECT id, title FROM Product WHERE categoryMatch = 0 AND xmlKey IS NOT NULL LIMIT 10").fetchall()
db.close()
print(f'Unmatched products in DB: {len(rows)}')

test_products = [{'id': row[0], 'title': row[1][:50]} for row in rows[:3]]

for i, p in enumerate(test_products):
    print(f'\n=== TEST {i+1}: {p["title"]}... ===')
    t0 = time.time()
    try:
        s, d = api('POST', '/category-engine/run', {'productIds': [p['id']]})
        elapsed = time.time() - t0
        print(f'HTTP {s} ({elapsed:.1f}s)')
        if s == 200:
            print(f'  ok={d.get("ok")} scanned={d.get("scanned")} applied={d.get("applied")}')
            for r in d.get('results', []):
                print(f'  method={r.get("method")} ext={r.get("externalId")} applied={r.get("applied")} reason={r.get("reason","")[:100]}')
        else:
            print(f'  ERROR: {json.dumps(d)[:200]}')
    except Exception as e:
        print(f'EXCEPTION: {e}')
    
    # Wait 15s between tests for OmniRoute cooldown
    if i < len(test_products) - 1:
        print(f'Waiting 15s for OmniRoute cooldown...')
        time.sleep(15)

# Process alive check
s2, _ = api('GET', '/auth/me')
print(f'\nProcess alive: {s2 == 200}')
