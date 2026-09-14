import http.client, json, sqlite3, time

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

# Get products — skip index 1 which crashes
db = sqlite3.connect(r'C:\PROJE 1\DG-STOK-THEME-V1\server\prisma\dev.db')
rows = db.execute("SELECT id, title FROM Product WHERE categoryMatch = 0 AND xmlKey IS NOT NULL LIMIT 10").fetchall()
db.close()

# Test products 0, 2, 3 (skip 1 which crashes)
test_indices = [0, 2, 3]

for idx in test_indices:
    if idx >= len(rows):
        continue
    pid = rows[idx][0]
    title = (rows[idx][1] or 'unknown')[:50]
    print(f'\n=== TEST idx={idx}: {title} ===')
    t0 = time.time()
    try:
        s, d = api('POST', '/category-engine/run', {'productIds': [pid]})
        elapsed = time.time() - t0
        print(f'HTTP {s} ({elapsed:.1f}s)')
        if s == 200:
            print(f'  ok={d.get("ok")} method={d.get("results",[{}])[0].get("method","?")} applied={d.get("applied")}')
        else:
            print(f'  ERROR: {json.dumps(d)[:200]}')
    except Exception as e:
        print(f'EXCEPTION: {e}')
    
    # Wait 25s between tests
    if idx != test_indices[-1]:
        print('Waiting 25s...')
        time.sleep(25)

s2, _ = api('GET', '/auth/me')
print(f'\nProcess alive: {s2 == 200}')
