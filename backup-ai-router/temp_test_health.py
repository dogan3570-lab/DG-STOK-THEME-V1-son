import http.client, json, time

# 1. Health check
try:
    c = http.client.HTTPConnection('localhost', 4100, timeout=5)
    c.request('GET', '/api/health')
    r = c.getresponse()
    health = json.loads(r.read())
    c.close()
    print('=== HEALTH CHECK ===')
    print(json.dumps(health, indent=2))
except Exception as e:
    print('BACKUP ROUTER DOWN:', e)
    exit(1)

# 2. Agents
try:
    c = http.client.HTTPConnection('localhost', 4100, timeout=5)
    c.request('GET', '/api/agents')
    r = c.getresponse()
    agents = json.loads(r.read())
    c.close()
    print()
    print('=== AGENTS ===')
    for a in agents['agents']:
        print('  %s (%s) status=%s quota=%s health=%s' % (a['id'], a['provider'], a['status'], a['quotaState'], a['healthState']))
except Exception as e:
    print('Agents error:', e)
