const sqlite3 = require('better-sqlite3');
const db = new sqlite3('C:\\PROJE 1\\DG-STOK-THEME-V1\\server\\dev.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("Tables:", tables);

// Find Product table
const productTable = tables.find(t => t.name.toLowerCase().includes('product'));
if (productTable) {
    const stats = db.prepare(`SELECT COUNT(*) as total, COUNT(purchasePrice) as with_cost, COUNT(salePrice) as with_price FROM ${productTable.name}`).get();
    console.log("Product stats:", stats);
    
    const samples = db.prepare(`SELECT id, title, purchasePrice, salePrice, stock FROM ${productTable.name} LIMIT 10`).all();
    console.log("Sample products:", samples);
}

// Check orders
const orderTables = tables.filter(t => t.name.toLowerCase().includes('order'));
console.log("Order tables:", orderTables);

db.close();