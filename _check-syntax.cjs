const fs = require('fs');
const html = fs.readFileSync('C:\\PROJE 1\\DG-STOK-THEME-V1\\dist\\index.html', 'utf-8');
const match = html.match(/<script>\s*\/\* =+ HELPERS =+ \*\/([\s\S]*?)<\/script>/);
const code = match[1];
try {
  new Function(code);
  console.log('SYNTAX OK');
} catch(e) {
  console.log('SYNTAX ERROR:', e.message);
  // Binary search for the error location
  let lo = 0, hi = code.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    try {
      new Function(code.substring(0, mid));
      lo = mid + 1;
    } catch(e2) {
      if (e2.message.includes(e.message.split('\n')[0].substring(0, 30))) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
  }
  const contextStart = Math.max(0, lo - 200);
  const contextEnd = Math.min(code.length, lo + 200);
  const context = code.substring(contextStart, contextEnd);
  const contextLines = context.split('\n');
  const relativeLine = context.split('\n').length - 1;
  console.log('\nError at approx position ' + lo + ':');
  for (let i = 0; i < contextLines.length; i++) {
    const marker = i === relativeLine ? '>>>' : '   ';
    console.log(marker + ' ' + contextLines[i].substring(0, 150));
  }
}
