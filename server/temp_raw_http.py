import http.client, json, time, socket

# Login
conn = http.client.HTTPConnection('localhost', 4000, timeout=10)
conn.request('POST', '/auth/login', json.dumps({'email': 'admin@dgstok.com', 'password': 'Stok2026!'}), {'Content-Type': 'application/json'})
r = conn.getresponse()
d = json.loads(r.read())
conn.close()
token = d['token']
print('Login OK')

# Raw HTTP to /category-engine/run
body = json.dumps({'productIds': ['8ab17f2e-d230-49fa-90a5-69676345efd1']})
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(60)
s.connect(('localhost', 4000))
req = 'POST /category-engine/run HTTP/1.1\r\nHost: localhost:4000\r\nContent-Type: application/json\r\nAuthorization: Bearer ' + token + '\r\nContent-Length: ' + str(len(body.encode())) + '\r\nConnection: close\r\n\r\n' + body
s.send(req.encode())
t0 = time.time()
try:
    resp = b''
    while True:
        chunk = s.recv(4096)
        if not chunk: break
        resp += chunk
    elapsed = time.time() - t0
    print('Run response (%.1fs): %s' % (elapsed, resp[:500].decode('utf-8', errors='replace')))
except Exception as e:
    elapsed = time.time() - t0
    print('Run error (%.1fs): %s' % (elapsed, e))
finally:
    s.close()

time.sleep(3)

# Now preview
s2 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s2.settimeout(60)
s2.connect(('localhost', 4000))
req2 = 'POST /category-engine/preview HTTP/1.1\r\nHost: localhost:4000\r\nContent-Type: application/json\r\nAuthorization: Bearer ' + token + '\r\nContent-Length: ' + str(len(body.encode())) + '\r\nConnection: close\r\n\r\n' + body
s2.send(req2.encode())
t1 = time.time()
try:
    resp2 = b''
    while True:
        chunk = s2.recv(4096)
        if not chunk: break
        resp2 += chunk
    elapsed2 = time.time() - t1
    print('Preview response (%.1fs): %s' % (elapsed2, resp2[:500].decode('utf-8', errors='replace')))
except Exception as e:
    elapsed2 = time.time() - t1
    print('Preview error (%.1fs): %s' % (elapsed2, e))
finally:
    s2.close()

time.sleep(2)
try:
    conn3 = http.client.HTTPConnection('localhost', 4000, timeout=5)
    conn3.request('GET', '/auth/me')
    r3 = conn3.getresponse()
    print('Process alive: %s' % (r3.status == 200))
except:
    print('Process alive: False')
