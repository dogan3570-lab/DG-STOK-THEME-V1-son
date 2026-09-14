import http.client, json, time

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

PRODUCT_ID = '8ab17f2e-d230-49fa-90a5-69676345efd1'

for test_num in range(1, 4):
    print(f'\n=== TEST {test_num}: {PRODUCT_ID[:20]}... ===')
    t0 = time.time()
    try:
        s, d = api('POST', '/category-engine/run', {'productIds': [PRODUCT_ID]})
        elapsed = time.time() - t0
        ok = d.get('ok')
        method = d.get('results', [{}])[0].get('method', '?')
        model = d.get('results', [{}])[0].get('model', d.get('results', [{}])[0].get('aiModel', 'N/A'))
        reason = d.get('results', [{}])[0].get('reason', '')[:80]
        print(f'HTTP {s} ({elapsed:.1f}s) ok={ok} method={method} model={model}')
        print(f'  reason={reason}')
        if s != 200:
            print(f'  ERROR BODY: {json.dumps(d)[:200]}')
    except Exception as e:
        elapsed = time.time() - t0
        print(f'EXCEPTION ({elapsed:.1f}s): {e}')
    
    # Wait 30s between tests
    if test_num < 3:
        print('Waiting 30s...')
        time.sleep(30)

# Process alive
s2, _ = api('GET', '/auth/me')
print(f'\nProcess alive: {s2 == 200}')
