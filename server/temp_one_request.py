import http.client, json, time

BASE = 'localhost:4000'

def api(method, path, body=None, timeout_s=90):
    conn = http.client.HTTPConnection(BASE, timeout=timeout_s)
    headers = {'Content-Type': 'application/json'}
    conn.request(method, path, json.dumps(body) if body else None, headers)
    r = conn.getresponse()
    data = json.loads(r.read())
    conn.close()
    return r.status, data

# Login
s, d = api('POST', '/auth/login', {'email': 'admin@dgstok.com', 'password': 'Stok2026!'})
token = d.get('token')
print(f'Login: {s}')

# Single test with auth header
conn = http.client.HTTPConnection(BASE, timeout=90)
headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'}
body = json.dumps({'productIds': ['8ab17f2e-d230-49fa-90a5-69676345efd1']})
print(f'Sending POST /category-engine/run...')
t0 = time.time()
try:
    conn.request('POST', '/category-engine/run', body, headers)
    print(f'Request sent, waiting for response...')
    r = conn.getresponse()
    data = json.loads(r.read())
    elapsed = time.time() - t0
    print(f'HTTP {r.status} ({elapsed:.1f}s)')
    print(json.dumps(data, indent=2, ensure_ascii=False)[:1000])
except Exception as e:
    elapsed = time.time() - t0
    print(f'EXCEPTION ({elapsed:.1f}s): {type(e).__name__}: {e}')
finally:
    conn.close()

# Check process
time.sleep(2)
try:
    s2, _ = api('GET', '/auth/me', timeout_s=5)
    print(f'Process alive: {s2 == 200}')
except:
    print(f'Process alive: False')
