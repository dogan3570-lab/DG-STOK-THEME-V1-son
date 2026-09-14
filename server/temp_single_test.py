import http.client, json, sqlite3

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
if s != 200 or not TOKEN:
    print(f'LOGIN FAILED: {d}')
    exit(1)

# Get 1 unmatched product
db = sqlite3.connect(r'C:\PROJE 1\DG-STOK-THEME-V1\server\prisma\dev.db')
rows = db.execute("SELECT id, title FROM Product WHERE categoryMatch = 0 AND xmlKey IS NOT NULL LIMIT 1").fetchall()
db.close()
if not rows:
    print('No unmatched products')
    exit(1)

pid = rows[0][0]
title = rows[0][1] or 'unknown'
print(f'\n=== SINGLE TEST: {title[:50]} ===')
print(f'Product ID: {pid}')

try:
    s, d = api('POST', '/category-engine/run', {'productIds': [pid]})
    print(f'HTTP {s}')
    print(json.dumps(d, indent=2, ensure_ascii=False)[:2000])
except Exception as e:
    print(f'EXCEPTION: {e}')

# Process alive?
s2, _ = api('GET', '/auth/me')
print(f'\nProcess alive: {s2 == 200}')
