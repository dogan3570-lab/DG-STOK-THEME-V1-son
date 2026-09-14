import http.client, json, time, sqlite3

BASE = 'localhost:4000'
TOKEN = None

def api(method, path, body=None):
    global TOKEN
    conn = http.client.HTTPConnection(BASE, timeout=120)
    headers = {'Content-Type': 'application/json'}
    if TOKEN: headers['Authorization'] = f'Bearer {TOKEN}'
    conn.request(method, path, json.dumps(body) if body else None, headers)
    r = conn.getresponse()
    data = json.loads(r.read())
    conn.close()
    return r.status, data

# Login
s, d = api('POST', '/auth/login', {'email': 'admin@dgstok.com', 'password': 'Stok2026!'})
TOKEN = d.get('token')
print(f'Login: {s}')
if s != 200 or not TOKEN:
    print(f'LOGIN FAILED: {d}')
    exit(1)

# Get 3 unmatched products from DB
db = sqlite3.connect(r'C:\PROJE 1\DG-STOK-THEME-V1\server\prisma\dev.db')
rows = db.execute("SELECT id, title FROM Product WHERE categoryMatch = 0 AND xmlKey IS NOT NULL LIMIT 10").fetchall()
db.close()
print(f'Unmatched products in DB: {len(rows)}')

test_products = [{'id': row[0], 'title': (row[1] or 'unknown')[:50]} for row in rows[:3]]

results_log = []

for i, p in enumerate(test_products):
    print(f'\n=== TEST {i+1}: {p["title"]}... ===')
    t0 = time.time()
    try:
        s, d = api('POST', '/category-engine/run', {'productIds': [p['id']]})
        elapsed = time.time() - t0
        print(f'HTTP {s} ({elapsed:.1f}s)')
        
        result_entry = {'test': i+1, 'http': s, 'elapsed': elapsed, 'pass': False}
        
        if s == 200:
            ok = d.get('ok')
            scanned = d.get('scanned')
            applied = d.get('applied')
            results = d.get('results', [])
            
            print(f'  ok={ok} scanned={scanned} applied={applied}')
            
            for r in results:
                method = r.get('method', 'unknown')
                ext = r.get('externalId')
                model = r.get('model', r.get('aiModel', 'N/A'))
                provider = r.get('provider', r.get('aiProvider', 'N/A'))
                applied_flag = r.get('applied', False)
                reason = r.get('reason', '')
                verified = r.get('verified', 'N/A')
                verified_conf = r.get('verifiedConfidence', 'N/A')
                
                print(f'  method={method} ext={ext} applied={applied_flag}')
                print(f'    provider={provider} model={model}')
                print(f'    verified={verified} verifiedConfidence={verified_conf}')
                print(f'    reason={reason[:120]}')
            
            # Pass criteria: HTTP 200 + ok=true + at least one result
            if ok and len(results) > 0:
                result_entry['pass'] = True
                # Check if any AI call happened
                ai_results = [r for r in results if r.get('method') == 'ai']
                if ai_results:
                    result_entry['ai_called'] = True
                    result_entry['provider'] = ai_results[0].get('provider', 'N/A')
                    result_entry['model'] = ai_results[0].get('model', 'N/A')
                    result_entry['verified'] = ai_results[0].get('verified', 'N/A')
                    print(f'  >>> AI PATH: provider={result_entry["provider"]} model={result_entry["model"]} verified={result_entry["verified"]}')
                else:
                    result_entry['ai_called'] = False
                    print(f'  >>> RULE PATH (no AI needed)')
        else:
            print(f'  ERROR: {json.dumps(d)[:300]}')
            result_entry['error'] = json.dumps(d)[:200]
        
        results_log.append(result_entry)
        
    except Exception as e:
        print(f'EXCEPTION: {e}')
        results_log.append({'test': i+1, 'pass': False, 'error': str(e)[:200]})
    
    # Wait 20s between tests for OmniRoute cooldown
    if i < len(test_products) - 1:
        print(f'Waiting 20s for OmniRoute cooldown...')
        time.sleep(20)

# Process alive check
s2, _ = api('GET', '/auth/me')
print(f'\nProcess alive: {s2 == 200}')

# Summary
print('\n=== E2E SUMMARY ===')
pass_count = sum(1 for r in results_log if r.get('pass'))
print(f'Passed: {pass_count}/{len(results_log)}')
for r in results_log:
    status = 'PASS' if r.get('pass') else 'FAIL'
    extra = ''
    if r.get('ai_called'):
        extra = f' AI={r.get("provider")}/{r.get("model")} verified={r.get("verified")}'
    elif r.get('pass'):
        extra = ' RULE_PATH'
    print(f'  Test {r["test"]}: {status} ({r.get("elapsed",0):.1f}s){extra}')
    if r.get('error'):
        print(f'    Error: {r["error"][:150]}')

# Final verdict
if pass_count == len(results_log) and s2 == 200:
    print('\nRESULT: PASS')
else:
    print('\nRESULT: FAIL')
