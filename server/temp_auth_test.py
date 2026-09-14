import http.client, json

BASE = 'localhost:4000'

# Login
conn = http.client.HTTPConnection(BASE, timeout=10)
conn.request('POST', '/auth/login', json.dumps({'email': 'admin@dgstok.com', 'password': 'Stok2026!'}), {'Content-Type': 'application/json'})
r = conn.getresponse()
data = json.loads(r.read())
conn.close()
token = data.get('token')
print(f'Login: {r.status} token_len={len(token) if token else 0}')

# Test auth
conn = http.client.HTTPConnection(BASE, timeout=10)
conn.request('GET', '/auth/me', None, {'Authorization': f'Bearer {token}'})
r = conn.getresponse()
data = json.loads(r.read())
conn.close()
print(f'Auth: {r.status} user={data.get("email", "?")}')

# Test preview (also uses requireAuth)
conn = http.client.HTTPConnection(BASE, timeout=10)
conn.request('POST', '/category-engine/preview', json.dumps({'productIds': ['8ab17f2e-d230-49fa-90a5-69676345efd1']}), {'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'})
r = conn.getresponse()
data = json.loads(r.read())
conn.close()
print(f'Preview: {r.status} keys={list(data.keys())[:5]}')

# Now try /run with same token
conn = http.client.HTTPConnection(BASE, timeout=10)
conn.request('POST', '/category-engine/run', json.dumps({'productIds': ['8ab17f2e-d230-49fa-90a5-69676345efd1']}), {'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'})
r = conn.getresponse()
data = json.loads(r.read())
conn.close()
print(f'Run: {r.status} ok={data.get("ok")} results={len(data.get("results", []))}')
