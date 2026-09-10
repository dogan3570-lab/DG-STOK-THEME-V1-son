// TASK314: Minimal XLSX (Office Open XML) + CSV okuyucu — dependency'siz.
// XLSX = ZIP içine gömülü XML. ZIP central directory + zlib.inflateRawSync ile çözülür.
// Kapsam: sharedStrings, inlineStr, str, n, b hücre tipleri; ilk worksheet.
import zlib from 'node:zlib';

type Row = Record<string, string>;

interface ZipEntry { name: string; data: Buffer; }

function readZip(buf: Buffer): ZipEntry[] {
  // Central directory imzası PK\x01\x02 (0x02014b50)
  const sig = 0x02014b50;
  let eocd = -1;
  // End of central directory PK\x05\x06
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP_EOF yok — dosya bozuk veya şifreli');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== sig) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    // Local header: gerçek offset'i bul
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) { p += 46 + nameLen + extraLen + commentLen; continue; }
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(dataStart, dataStart + compSize);
    let data: Buffer;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`Desteklenmeyen ZIP sıkıştırma yöntemi: ${method}`);
    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function xmlDecode(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const inner = m[1];
    const ts = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]);
    out.push(xmlDecode(ts.join('')));
  }
  return out;
}

function colToIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    if (ch >= 'A' && ch <= 'Z') n = n * 26 + (ch.charCodeAt(0) - 64);
    else if (ch >= 'a' && ch <= 'z') n = n * 26 + (ch.charCodeAt(0) - 96);
    else break;
  }
  return Math.max(0, n - 1);
}

function parseSheet(xml: string, shared: string[]): Map<number, Row> {
  const rows = new Map<number, Row>();
  const rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const rowIdx = Number(rm[1]);
    const cells: Row = {};
    const cRe = /<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(rm[2]))) {
      const attrs = cm[1] ?? cm[3] ?? '';
      const body = cm[2] ?? '';
      const refM = attrs.match(/r="([A-Z]+)\d+"/i);
      const tM = attrs.match(/t="([a-z]+)"/);
      if (!refM) continue;
      const colIdx = colToIndex(refM[1]);
      let value = '';
      const vM = body.match(/<v[^>]*>([\s\S]*?)<\/v>/);
      if (tM && tM[1] === 's' && vM) value = shared[Number(vM[1])] ?? '';
      else if (tM && tM[1] === 'inlineStr') {
        value = xmlDecode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
      } else if (vM) value = xmlDecode(vM[1]);
      cells[colIdx] = String(value).trim();
    }
    rows.set(rowIdx, cells);
  }
  return rows;
}

export interface ParsedSheet { headers: string[]; rows: Array<Record<string, string>>; }

/** XLSX buffer → ilk worksheet → header satırı + data satırları */
export function parseXlsx(buf: Buffer): ParsedSheet {
  const entries = readZip(buf);
  const sharedEntry = entries.find(e => e.name === 'xl/sharedStrings.xml');
  const shared = sharedEntry ? parseSharedStrings(sharedEntry.data.toString('utf8')) : [];
  const sheetEntry =
    entries.find(e => /^xl\/worksheets\/sheet1\.xml$/i.test(e.name)) ||
    entries.find(e => /^xl\/worksheets\/.*\.xml$/i.test(e.name));
  if (!sheetEntry) throw new Error('XLSX içinde worksheet bulunamadı');
  const grid = parseSheet(sheetEntry.data.toString('utf8'), shared);
  if (grid.size === 0) return { headers: [], rows: [] };
  const firstRowIdx = Math.min(...grid.keys());
  const headerCells = grid.get(firstRowIdx) ?? {};
  const maxCol = Math.max(0, ...Object.keys(headerCells).map(Number));
  const headers: string[] = [];
  for (let i = 0; i <= maxCol; i++) headers.push(String(headerCells[i] ?? '').trim());
  const rows: Array<Record<string, string>> = [];
  for (const [idx] of [...grid.entries()].sort((a, b) => a[0] - b[0])) {
    if (idx <= firstRowIdx) continue;
    const cells = grid.get(idx) ?? {};
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (h) row[h] = String(cells[i] ?? '').trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

/** Basit CSV parser (tırnak destekli) */
export function parseCsvText(text: string): ParsedSheet {
  const clean = text.replace(/^\uFEFF/, '');
  const delim = (clean.split('\n')[0].match(/;/g)?.length ?? 0) > (clean.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const lines: string[][] = [];
  let cur: string[] = [], field = '', inQ = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQ) {
      if (ch === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { cur.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      cur.push(field); field = ''; lines.push(cur); cur = [];
    } else field += ch;
  }
  if (field !== '' || cur.length) { cur.push(field); lines.push(cur); }
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].map(h => h.trim());
  const rows = lines.slice(1).filter(l => l.some(c => c.trim() !== '')).map(l => {
    const r: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) r[h] = (l[i] ?? '').trim(); });
    return r;
  });
  return { headers, rows };
}
