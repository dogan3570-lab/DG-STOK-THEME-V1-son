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

# Single product test
pid = '439bd5e1-790d-421c-8cfa-21278b4a5098'
print(f'Category Run: {pid}')

t0 = time.time()
try:
    status, result = api('POST', '/category-engine/run', {'productIds': [pid]}, token=token)
    elapsed = time.time() - t0
    print(f'HTTP {status} ({elapsed:.1f}s)')
    print(f'result: {json.dumps(result)[:500]}')
except Exception as e:
    elapsed = time.time() - t0
    print(f'EXCEPTION ({elapsed:.1f}s): {type(e).__name__}: {e}')

# Wait and check if server is alive
time.sleep(3)
try:
    status, _ = api('GET', '/auth/me', token=token)
    print(f'Alive after: {status}')
except Exception as e:
    print(f'Alive check: {type(e).__name__}: {e}')
