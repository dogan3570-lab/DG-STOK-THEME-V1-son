import http.client, json, time, subprocess, sys

def api(method, path, body=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Cookie'] = f'token={token}'
    conn = http.client.HTTPConnection('localhost', 4000, timeout=300)
    payload = json.dumps(body) if body else None
    conn.request(method, path, payload, headers)
    r = conn.getresponse()
    data = r.read().decode()
    return r.status, json.loads(data) if data else {}

# Login
status, login_data = api('POST', '/auth/login', {'email': 'admin@dgstok.com', 'password': 'Stok2026!'})
token = login_data.get('token', '')
print(f'Login: {status}')

# Get PID before
r = subprocess.run(['pm2', 'pid', 'dg-stok'], capture_output=True, text=True, encoding='utf-8', errors='replace')
pid_before = r.stdout.strip().split('\n')[-1].strip()
print(f'PID before: {pid_before}')

# Get restart count before
r = subprocess.run(['pm2', 'jlist'], capture_output=True, text=True, encoding='utf-8', errors='replace')
jlist = json.loads(r.stdout)
reboots_before = jlist[0].get('pm2_env', {}).get('restart_time', 0) if jlist else 0
print(f'Restarts before: {reboots_before}')

# Check PM2 max_memory_restart setting
pm2_env = jlist[0].get('pm2_env', {}) if jlist else {}
print(f'max_memory_restart: {pm2_env.get("max_memory_restart", "NOT SET")}')
print(f'exec_mode: {pm2_env.get("exec_mode", "?")}')

# Now trigger the AI call
pid = '439bd5e1-790d-421c-8cfa-21278b4a5098'
print(f'\nSending Category Run for {pid}...')
t0 = time.time()
try:
    status, result = api('POST', '/category-engine/run', {'productIds': [pid]}, token=token)
    elapsed = time.time() - t0
    print(f'HTTP {status} ({elapsed:.1f}s)')
    print(f'result: {json.dumps(result)[:300]}')
except Exception as e:
    elapsed = time.time() - t0
    print(f'EXCEPTION ({elapsed:.1f}s): {type(e).__name__}: {e}')

# Check PID after
time.sleep(2)
r = subprocess.run(['pm2', 'pid', 'dg-stok'], capture_output=True, text=True, encoding='utf-8', errors='replace')
pid_after = r.stdout.strip().split('\n')[-1].strip()
print(f'\nPID after: {pid_after}')
print(f'PID changed: {pid_before != pid_after}')

# Check restart count after
r = subprocess.run(['pm2', 'jlist'], capture_output=True, text=True, encoding='utf-8', errors='replace')
jlist2 = json.loads(r.stdout)
reboots_after = jlist2[0].get('pm2_env', {}).get('restart_time', 0) if jlist2 else 0
print(f'Restarts after: {reboots_after}')
print(f'Restarts increased: {reboots_after - reboots_before}')

# Check memory
if jlist2:
    monit = jlist2[0].get('monit', {})
    print(f'Memory: {monit.get("memory", 0) / 1024 / 1024:.1f} MB')
    print(f'CPU: {monit.get("cpu", 0)}%')
