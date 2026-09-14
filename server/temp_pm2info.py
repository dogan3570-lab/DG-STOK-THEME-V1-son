import json, subprocess

result = subprocess.run(['pm2', 'jlist'], capture_output=True, text=True)
data = json.loads(result.stdout)
if data:
    d = data[0]
    print(f'PM2 PID: {d["pid"]}')
    print(f'Script: {d["pm2_env"]["pm_exec_path"]}')
    print(f'Interpreter: {d["pm2_env"]["exec_interpreter"]}')
    print(f'Node args: {d["pm2_env"].get("node_args", "N/A")}')
    print(f'Exec mode: {d["pm2_env"]["exec_mode"]}')
