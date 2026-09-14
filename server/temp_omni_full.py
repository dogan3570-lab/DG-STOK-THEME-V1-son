import urllib.request, json

# Test /v1/chat/completions with full response
print('=== OmniRoute /v1/chat/completions FULL RESPONSE ===')
try:
    req = urllib.request.Request(
        'http://localhost:20128/v1/chat/completions',
        data=json.dumps({
            'model': 'auto/best-free',
            'messages': [{'role': 'user', 'content': 'Say hi in one word'}],
            'max_tokens': 50
        }).encode(),
        headers={'Content-Type': 'application/json'}
    )
    resp = urllib.request.urlopen(req, timeout=10)
    data = json.loads(resp.read().decode())
    print(json.dumps(data, indent=2)[:1000])
except urllib.error.HTTPError as e:
    print('HTTP', e.code, ':', e.read().decode()[:500])
except Exception as e:
    print('ERROR:', e)

# Test with specific free model
print('\n=== Test with mimo-v2.5-free ===')
try:
    req = urllib.request.Request(
        'http://localhost:20128/v1/chat/completions',
        data=json.dumps({
            'model': 'mimo-v2.5-free',
            'messages': [{'role': 'user', 'content': 'Say hi'}],
            'max_tokens': 50
        }).encode(),
        headers={'Content-Type': 'application/json'}
    )
    resp = urllib.request.urlopen(req, timeout=10)
    data = json.loads(resp.read().decode())
    print('HTTP 200')
    print('Model:', data.get('model'))
    print('Choices:', json.dumps(data.get('choices'), indent=2)[:500])
    print('Content:', data.get('choices', [{}])[0].get('message', {}).get('content'))
except urllib.error.HTTPError as e:
    print('HTTP', e.code, ':', e.read().decode()[:500])
except Exception as e:
    print('ERROR:', e)