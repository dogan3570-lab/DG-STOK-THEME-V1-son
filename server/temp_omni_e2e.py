import sqlite3, urllib.request, json

# DB check
c = sqlite3.connect('C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db').cursor()
c.execute("SELECT provider, active, apiKeyEncrypted IS NOT NULL, apiKeyIv IS NOT NULL FROM AIProviderConfig WHERE provider = 'omniroute'")
row = c.fetchone()
print('omniroute DB:', row)

# Direct OmniRoute /v1/models
print('\n=== OmniRoute /v1/models DIRECT ===')
try:
    req = urllib.request.Request('http://localhost:20128/v1/models')
    resp = urllib.request.urlopen(req, timeout=5)
    data = json.loads(resp.read().decode())
    print('HTTP 200')
    print('Models count:', len(data.get('data', [])))
    for m in data.get('data', [])[:5]:
        print('  -', m.get('id'))
except urllib.error.HTTPError as e:
    print('HTTP', e.code, ':', e.read().decode()[:200])
except Exception as e:
    print('ERROR:', e)

# Direct OmniRoute /v1/chat/completions
print('\n=== OmniRoute /v1/chat/completions DIRECT ===')
try:
    req = urllib.request.Request(
        'http://localhost:20128/v1/chat/completions',
        data=json.dumps({'model': 'auto/best-free', 'messages': [{'role': 'user', 'content': 'Say hi'}], 'max_tokens': 10}).encode(),
        headers={'Content-Type': 'application/json'}
    )
    resp = urllib.request.urlopen(req, timeout=10)
    data = json.loads(resp.read().decode())
    print('HTTP 200')
    print('Model:', data.get('model'))
    print('Content:', data.get('choices', [{}])[0].get('message', {}).get('content', ''))
except urllib.error.HTTPError as e:
    print('HTTP', e.code, ':', e.read().decode()[:300])
except Exception as e:
    print('ERROR:', e)