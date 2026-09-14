import json, subprocess
r = subprocess.run(['pm2', 'jlist'], capture_output=True, text=True)
apps = json.loads(r.stdout)
for a in apps:
    if a['name'] == 'dg-stok':
        print(f'restarts={a["pm2_env"]["restart_time"]} pid={a["pid"]}')
