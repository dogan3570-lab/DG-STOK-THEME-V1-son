with open('C:/PROJE 1/DG-STOK-THEME-V1/server/src/routes/categoryMatchEngine.ts', 'r') as f:
    content = f.read()
lines = content.splitlines()
new_lines = [line for line in lines if 'DEBUG-RUN' not in line]
with open('C:/PROJE 1/DG-STOK-THEME-V1/server/src/routes/categoryMatchEngine.ts', 'w') as f:
    f.write('\n'.join(new_lines))
print('Cleaned', len(lines)-len(new_lines), 'lines')
