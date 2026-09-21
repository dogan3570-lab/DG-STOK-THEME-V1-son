// scripts/rt-mr225-pick.ts
import { readFileSync } from 'node:fs';
const mr = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/mr225.json', 'utf8'));
const GROUPS = ['Avize','Toka','Vazo','Çerçeve','Kahve Fincanı','Dönüştürücü','Şarj Aleti','Dil Temizleyici','Fıskiye','Hortum Bağlantısı','Testere','Projektör','Led Işık','Pense','Mangal','Kaşıklık','Terazi','Tencere','Kanepe','Bardak','Terlik','Kilit','Kase','Kemer','Ceviz','Saksı','3D Yazıcı','Duş Jeli','Parke','Resim','Mala','Ayna','Tuval','Şeker Hamuru','Kumaş','Atkı','Yatak','Havlu','Askılık','El Çantası','Sepet'];
for (const g of GROUPS) {
  const rows = mr.filter((d: any) => d.target === g);
  if (!rows.length) continue;
  console.log(`\n### ${g} (${rows.length})`);
  for (const r of rows) console.log(`  ${r.xmlKey} | sc=${r.supplierCategory||'(null)'} | ${String(r.title).slice(0,82)}`);
}
