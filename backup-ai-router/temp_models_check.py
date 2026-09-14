import http.client, json

# Test /v1/models with different auth options
tests = [
    ('No auth', {}),
    ('Bearer omni', {'Authorization': 'Bearer omni'}),
]

for name, headers in tests:
    try:
        c = http.client.HTTPConnection('localhost', 20128, timeout=5)
        c.request('GET', '/v1/models', headers=headers)
        r = c.getresponse()
        data = r.read().decode()
        c.close()
        print('OmniRoute /v1/models [%s]: HTTP %d' % (name, r.status))
        print('  Body: %s' % data[:300])
    except Exception as e:
        print('OmniRoute /v1/models [%s]: ERROR %s' % (name, e))
    print()
