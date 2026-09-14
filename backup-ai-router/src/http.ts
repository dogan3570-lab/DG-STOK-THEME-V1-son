import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export interface HttpResult {
  ok: boolean;
  status: number;
  body: string;
  latencyMs: number;
  headers: Record<string, string>;
}

export function httpGet(url: string, headers?: Record<string, string>, timeoutMs: number = 30000): Promise<HttpResult> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const startTime = Date.now();
    const timer = setTimeout(() => {
      resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime, headers: {} });
    }, timeoutMs);

    const req = mod.get(url, { headers, timeout: timeoutMs }, (res: any) => {
      let data = '';
      const respHeaders: Record<string, string> = {};
      Object.entries(res.headers).forEach(([k, v]) => { respHeaders[k] = String(v); });
      res.on('data', (chunk: any) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode!, body: data, latencyMs: Date.now() - startTime, headers: respHeaders });
      });
      res.on('error', () => { clearTimeout(timer); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime, headers: {} }); });
    });
    req.on('error', () => { clearTimeout(timer); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime, headers: {} }); });
    req.on('timeout', () => { req.destroy(); clearTimeout(timer); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime, headers: {} }); });
  });
}

export function httpPost(url: string, body: any, headers?: Record<string, string>, timeoutMs: number = 30000): Promise<HttpResult> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const startTime = Date.now();
    const allHeaders = { ...headers, 'Content-Length': Buffer.byteLength(bodyStr).toString() };
    const timer = setTimeout(() => {
      resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime, headers: {} });
    }, timeoutMs);

    const req = mod.request(url, { method: 'POST', headers: allHeaders, timeout: timeoutMs }, (res: any) => {
      let data = '';
      const respHeaders: Record<string, string> = {};
      Object.entries(res.headers).forEach(([k, v]) => { respHeaders[k] = String(v); });
      res.on('data', (chunk: any) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode!, body: data, latencyMs: Date.now() - startTime, headers: respHeaders });
      });
      res.on('error', () => { clearTimeout(timer); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime, headers: {} }); });
    });
    req.on('error', () => { clearTimeout(timer); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime, headers: {} }); });
    req.on('timeout', () => { req.destroy(); clearTimeout(timer); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime, headers: {} }); });
    req.write(bodyStr);
    req.end();
  });
}
