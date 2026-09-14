import type { RequestLog } from './types.ts';

const logs: RequestLog[] = [];
const MAX_LOGS = 1000;

export function logRequest(entry: RequestLog): void {
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  const status = entry.status === 'SUCCESS' ? '\x1b[32mOK\x1b[0m' : entry.status === 'FALLBACK' ? '\x1b[33mFALLBACK\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`[${status}] ${entry.requestId.slice(0, 8)} agent=${entry.agentId} provider=${entry.provider} model=${entry.model} quota=${entry.quotaState} health=${entry.healthState} latency=${entry.latencyMs}ms${entry.fallbackFrom ? ' from=' + entry.fallbackFrom : ''}${entry.errorCode ? ' err=' + entry.errorCode : ''}`);
}

export function getLogs(limit: number = 50): RequestLog[] {
  return logs.slice(-limit);
}

export function generateRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
