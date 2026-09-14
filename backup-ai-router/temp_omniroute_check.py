import http.client, json

# Test OmniRoute-2 endpoints
endpoints = [
    ('/api/health', 'Health'),
    ('/v1/models', 'Models'),
    ('/v1/chat/completions', 'Chat'),
]

for path, name in endpoints:
    try:
        c = http.client.HTTPConnection('localhost', 20128, timeout=5)
        if path == '/v1/chat/completions':
            body = json.dumps({'model': 'auto/best-free', 'messages': [{'role': 'user', 'content': 'Say OK'}], 'max_tokens': 5, 'stream': False})
            c.request('POST', path, body, {'Content-Type': 'application/json', 'Authorization': 'Bearer omni'})
        else:
            c.request('GET', path, headers={'Authorization': 'Bearer omni'})
        r = c.getresponse()
        data = r.read().decode()
        c.close()
        print('OmniRoute %s: HTTP %d' % (name, r.status))
        print('  Body: %s' % data[:200])
    except Exception as e:
        print('OmniRoute %s: ERROR %s' % (name, e))
    print()
