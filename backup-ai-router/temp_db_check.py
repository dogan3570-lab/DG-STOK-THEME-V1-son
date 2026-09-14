import sqlite3
conn = sqlite3.connect('C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db')
row = conn.execute("SELECT apiKeyEncrypted FROM AIProviderConfig WHERE provider='omniroute'").fetchone()
if row:
    print('omniroute key encrypted=' + str(row[0]))
else:
    print('omniroute NOT FOUND')
conn.close()
