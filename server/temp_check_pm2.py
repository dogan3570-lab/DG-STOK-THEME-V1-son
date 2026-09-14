import json
with open(r'C:\Users\Dogan\.pm2\dump.pm2') as f:
    data = json.load(f)
for p in data:
    print(f"{p.get('name', '?')}: {p.get('pm_exec_path', '?')}")
