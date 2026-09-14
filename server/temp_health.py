import json, subprocess, http.client

# PM2 process info
result = subprocess.run(['pm2', 'jlist'], capture_output=True, text=True)
data = json.loads(result.stdout)
if data:
    d = data[0]
    print(f'PM2 PID: {d["pid"]} name: {d["name"]} status: {d["pm2_env"]["status"]} restarts: {d["pm2_env"]["restart_time"]}')

# Simple health check
conn = http.client.HTTPConnection('localhost', 4000, timeout=10)
conn.request('GET', '/auth/me')
r = conn.getresponse()
print(f'Health: HTTP {r.status}')
conn.close()
