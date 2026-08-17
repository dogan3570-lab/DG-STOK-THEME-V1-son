import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * SSRF koruması: yalnızca http/https şemalarına izin verir;
 * localhost, loopback, private/link-local/reserved IPv4-IPv6 ve metadata
 * hostları engellenir. DNS çözümleme sonrası IP tekrar kontrol edilir.
 *
 * NOT: Node fetch bağlantı anında IP'yi yeniden doğrulamadığı için DNS
 * rebinding'e karşı tam koruma sağlamaz — bu bilinen bir kısıttır (raporlanır).
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
  '169.254.169.254',
]);

function isPrivateOrReservedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (/^f[cd]/.test(lower)) return true; // unique local
    if (/^fe[89ab]/.test(lower)) return true; // link-local
    return false;
  }
  return true; // tanınamayan IP engellenir
}

export interface SsrfCheckResult {
  ok: boolean;
  url?: URL;
  reason?: string;
}

export async function assertSafeApiUrl(rawUrl: string): Promise<SsrfCheckResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'INVALID_URL' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'INVALID_SCHEME' };
  }

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: 'BLOCKED_HOST' };
  }

  const literal = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  if (isIP(literal)) {
    if (isPrivateOrReservedIp(literal)) {
      return { ok: false, reason: 'BLOCKED_IP' };
    }
    return { ok: true, url };
  }

  try {
    const addrs = await lookup(hostname, { all: true });
    if (addrs.length === 0) {
      return { ok: false, reason: 'DNS_EMPTY' };
    }
    for (const a of addrs) {
      if (isPrivateOrReservedIp(a.address)) {
        return { ok: false, reason: 'BLOCKED_IP' };
      }
    }
  } catch {
    return { ok: false, reason: 'DNS_FAILED' };
  }

  return { ok: true, url };
}
