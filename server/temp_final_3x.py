import http.client, json, time

BASE = 'localhost:4000'
TOKEN = None

def api(method, path, body=None, timeout_s=90):
    global TOKEN
    conn = http.client.HTTPConnection(BASE, timeout=timeout_s)
    headers = {'Content-Type': 'application/json'}
    if TOKEN: headers['Authorization'] = f'Bearer {TOKEN}'
    conn.request(method, path, json.dumps(body) if body else None, headers)
    r = conn.getresponse()
    data = json.loads(r.read())
    conn.close()
    return r.status, data

def alive():
    try:
        s, _ = api('GET', '/auth/me', timeout_s=5)
        return s == 200
    except:
        return False

# Login
s, d = api('POST', '/auth/login', {'email': 'admin@dgstok.com', 'password': 'Stok2026!'})
TOKEN = d.get('token')
print(f'Login: {s} alive_before={alive()}')

PID = '8ab17f2e-d230-49fa-90a5-69676345efd1'

for i in range(1, 4):
    print(f'\n--- TEST {i} ---')
    alive_before = alive()
    print(f'  alive_before={alive_before}')
    
    t0 = time.time()
    try:
        s, d = api('POST', '/category-engine/run', {'productIds': [PID]})
        elapsed = time.time() - t0
        print(f'  HTTP {s} ({elapsed:.1f}s)')
        results = d.get('results', [])
        for r in results:
            print(f'  method={r.get("method")} ext={r.get("externalId")} applied={r.get("applied")} reason={r.get("reason","")[:80]}')
        if s == 200:
            print(f'  ok={d.get("ok")} scanned={d.get("scanned")} applied={d.get("applied")}')
    except Exception as e:
        elapsed = time.time() - t0
        print(f'  EXCEPTION ({elapsed:.1f}s): {type(e).__name__}: {e}')
    
    alive_after = alive()
    print(f'  alive_after={alive_after}')
    
    if i < 3:
        print('  cooldown 30s...')
        time.sleep(30)

print(f'\nFinal alive: {alive()}')
