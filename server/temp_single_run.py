import http.client, json, time

def api(method, path, body=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Cookie'] = f'token={token}'
    conn = http.client.HTTPConnection('localhost', 4000, timeout=300)
    payload = json.dumps(body) if body else None
    conn.request(method, path, payload, headers)
    r = conn.getresponse()
    data = r.read().decode()
    return r.status, json.loads(data) if data else {}

# Login
status, login_data = api('POST', '/auth/login', {'email': 'admin@dgstok.com', 'password': 'Stok2026!'})
token = login_data.get('token', '')
print(f'Login: {status}')

# Run single product that needs AI
pid = '439bd5e1-790d-421c-8cfa-21278b4a5098'
print(f'Testing single product: {pid}')

t0 = time.time()
try:
    status, result = api('POST', '/category-engine/run', {'productIds': [pid]}, token=token)
    elapsed = time.time() - t0
    print(f'HTTP {status} ({elapsed:.1f}s)')
    print(f'ok={result.get("ok")}')
    if result.get('error'):
        print(f'error={json.dumps(result["error"])[:300]}')
    if result.get('results'):
        for r in result['results'][:3]:
            print(f'  result: {json.dumps(r)[:200]}')
except Exception as e:
    elapsed = time.time() - t0
    print(f'EXCEPTION ({elapsed:.1f}s): {e}')
