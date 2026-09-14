import sqlite3
db = sqlite3.connect(r'C:\PROJE 1\DG-STOK-THEME-V1\server\prisma\dev.db')
r = db.execute('SELECT id, title, supplierCategory, xmlBrandName, description FROM Product WHERE id = ?', ('96be3298-2b59-4409-9edc-ff6618eaf7ba',)).fetchone()
print('title:', r[1])
print('supplierCategory:', r[2])
print('brand:', r[3])
print('description:', (r[4] or '')[:500])
print('desc len:', len(r[4] or ''))
db.close()
