import sqlite3, urllib.request, json

# Check DB state
c = sqlite3.connect('C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db').cursor()
c.execute("SELECT provider, active, apiKeyEncrypted IS NOT NULL, apiKeyIv IS NOT NULL, lastStatus, lastError FROM AIProviderConfig WHERE provider = 'omniroute'")
row = c.fetchone()
print('omniroute DB state:', row)

# Check if key can be decrypted
print('\n=== Try decrypt key ===')
try:
    import sys
    sys.path.insert(0, 'C:\\PROJE 1\\DG-STOK-THEME-V1\\server')
    from src.services.crypto import decryptApiKey
    c.execute("SELECT apiKeyEncrypted, apiKeyIv, apiKeyTag FROM AIProviderConfig WHERE provider = 'omniroute'")
    r = c.fetchone()
    if r and r[0] and r[1] and r[2]:
        plain = decryptApiKey(r[0], r[1], r[2])
        print(f'Decrypted key: {plain[:10]}... (len={len(plain)})')
    else:
        print('No encrypted key fields')
except Exception as e:
    print(f'Decrypt error: {e}')

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
    print('Content:', data.get('choices', [{}])[0].get('message', {}).get('content'))
except urllib.error.HTTPError as e:
    print('HTTP', e.code, ':', e.read().decode()[:200])
except Exception as e:
    print('ERROR:', e)