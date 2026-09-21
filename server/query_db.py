import sqlite3
conn = sqlite3.connect(r'C:\PROJE 1\DG-STOK-THEME-V1\server\dev.db')
cursor = conn.cursor()
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cursor.fetchall()
print("Tables:", tables)

# Find Product table
product_table = None
for t in tables:
    if 'product' in t[0].lower():
        product_table = t[0]
        break

if product_table:
    cursor.execute(f"SELECT COUNT(*) as total, COUNT(purchasePrice) as with_cost, COUNT(salePrice) as with_price FROM {product_table}")
    print("Product stats:", cursor.fetchall())
    
    # Check sample of products
    cursor.execute(f"SELECT id, title, purchasePrice, salePrice, stock FROM {product_table} LIMIT 10")
    print("Sample products:", cursor.fetchall())
    
    # Check orders
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%order%'")
    print("Order tables:", cursor.fetchall())

conn.close()