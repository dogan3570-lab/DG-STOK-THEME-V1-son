import Database from 'better-sqlite3';
const db = new Database('C:\\Users\\Dogan\\.local\\share\\opencode\\opencode.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables);
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log(`\nTable ${t.name}:`, cols.map(c=>c.name).join(', '));
  const rows = db.prepare(`SELECT * FROM ${t.name} LIMIT 5`).all();
  console.log('Sample rows:', JSON.stringify(rows, null, 2));
}