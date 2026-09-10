const fs = require('fs');
const s = fs.readFileSync('_faz4-parse-fail.txt', 'utf8');

function san(str) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; }
      else if (ch === '\\') { out += ch; esc = true; }
      else if (ch === '"') { out += ch; inStr = false; }
      else if (ch.charCodeAt(0) < 0x20) {
        if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else out += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
      } else out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

const out = san(s);
console.log('sanLen', out.length);
try {
  const p = JSON.parse(out);
  console.log('PARSE_OK', p.matches.length);
} catch (e) {
  console.log('ERR', e.message);
}
